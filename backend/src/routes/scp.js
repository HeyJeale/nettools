'use strict';
const { Client } = require('ssh2');
const path = require('path');
const sessions = require('../services/sessions');

function getConfig(sessionId) {
  return sessions.get(sessionId) || null;
}

// Run a command over SSH, collect stdout, return { stdout, stderr, code }
function sshExec(config, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        let stdout = '', stderr = '';
        stream.on('data', (d) => { stdout += d; });
        stream.stderr.on('data', (d) => { stderr += d; });
        stream.on('close', (code) => { conn.end(); resolve({ stdout, stderr, code }); });
      });
    });
    conn.on('error', reject);
    conn.connect({ host: config.host, port: config.port, username: config.username, password: config.password });
  });
}

// Parse `ls -la` output into file objects
function parseLs(output) {
  const files = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('total')) continue;
    const m = trimmed.match(/^([dlrwxstT\-]{10}[\+@.]?)\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+\s+\S+\s+\S+)\s+(.+)$/);
    if (!m) continue;
    const [, perms, owner, group, size, date, name] = m;
    const realName = name.split(' -> ')[0].trim();
    if (realName === '.' || realName === '..') continue;
    const typeChar = perms[0];
    const fileType = typeChar === 'd' ? 'directory'
      : typeChar === 'l' ? 'symlink'
      : typeChar === 'p' ? 'pipe'
      : typeChar === 's' ? 'socket'
      : typeChar === 'c' ? 'char-device'
      : typeChar === 'b' ? 'block-device'
      : 'file';
    files.push({
      name: realName,
      size: parseInt(size),
      isDir: typeChar === 'd',
      isLink: typeChar === 'l',
      fileType,
      perms,
      owner,
      group,
      mtime: date.trim(),
    });
  }
  return files;
}

module.exports = async function scpRoutes(fastify) {
  // List remote directory via `ls -la`
  fastify.get('/list', async (req, reply) => {
    const { sessionId, remotePath = '.' } = req.query;
    const config = getConfig(sessionId);
    if (!config) return reply.code(400).send({ error: 'Session not found' });

    try {
      const { stdout, stderr, code } = await sshExec(config, `ls -la "${remotePath}" 2>&1`);
      if (code !== 0) return reply.code(500).send({ error: stderr || stdout });
      const files = parseLs(stdout);
      // Log raw output so we can debug parse issues
      if (files.length === 0) fastify.log.warn({ raw: stdout }, 'ls parsed 0 files');
      return { files, path: remotePath };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Upload local file → remote via `scp -t` protocol over exec
  fastify.post('/upload', async (req, reply) => {
    let sessionId, remotePath, fileBuffer, fileName;

    for await (const part of req.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'sessionId') sessionId = part.value;
        if (part.fieldname === 'remotePath') remotePath = part.value;
      } else {
        fileName = part.filename;
        fileBuffer = await part.toBuffer();
      }
    }

    const config = getConfig(sessionId);
    if (!config) return reply.code(400).send({ error: 'Session not found' });

    const destDir = remotePath || '.';
    const destPath = path.posix.join(destDir, fileName);

    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => {
        // Use `scp -t <dir>` sink mode
        conn.exec(`scp -t "${destDir}"`, (err, stream) => {
          if (err) { conn.end(); return reject(err); }

          let stderr = '';
          stream.stderr.on('data', (d) => { stderr += d; });

          function waitAck(cb) {
            stream.once('data', (d) => {
              if (d[0] === 0) cb(null);
              else cb(new Error(`SCP error: ${d.slice(1).toString()}`));
            });
          }

          // SCP sink protocol: wait initial ack, send header, wait ack, send data, send \0, wait ack
          waitAck((err) => {
            if (err) { conn.end(); return reject(err); }
            const header = `C0644 ${fileBuffer.length} ${fileName}\n`;
            stream.write(header);
            waitAck((err) => {
              if (err) { conn.end(); return reject(err); }
              stream.write(fileBuffer);
              stream.write(Buffer.from([0])); // end of file marker
              waitAck((err) => {
                stream.end();
                conn.end();
                if (err) reject(err); else resolve({ ok: true, path: destPath });
              });
            });
          });

          stream.on('close', (code) => {
            if (code !== 0 && stderr) reject(new Error(stderr));
          });
        });
      });
      conn.on('error', reject);
      conn.connect({ host: config.host, port: config.port, username: config.username, password: config.password });
    }).catch((err) => reply.code(500).send({ error: err.message }));
  });

  // Download remote file → browser via `cat`
  fastify.get('/download', async (req, reply) => {
    const { sessionId, remotePath } = req.query;
    const config = getConfig(sessionId);
    if (!config) return reply.code(400).send({ error: 'Session not found' });

    const fileName = path.posix.basename(remotePath);
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    reply.header('Content-Type', 'application/octet-stream');

    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => {
        conn.exec(`cat "${remotePath}"`, (err, stream) => {
          if (err) { conn.end(); return reject(err); }
          stream.on('error', (e) => { conn.end(); reject(e); });
          stream.on('close', () => conn.end());
          resolve(stream);
        });
      });
      conn.on('error', reject);
      conn.connect({ host: config.host, port: config.port, username: config.username, password: config.password });
    }).then((stream) => reply.send(stream))
      .catch((err) => reply.code(500).send({ error: err.message }));
  });
};
