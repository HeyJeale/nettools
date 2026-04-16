'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { v4: uuidv4 } = require('uuid');
const sessions = require('../services/sessions');

// Strip ANSI / VT100 escape sequences so log files are plain text
function stripAnsi(s) {
  return s
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '')   // CSI sequences (colors, cursor)
    .replace(/\x1B\][^\x07]*\x07/g, '')         // OSC + BEL
    .replace(/\x1B\][^\x1B]*\x1B\\/g, '')       // OSC + ST
    .replace(/\x1B[()][B0UK]/g, '')              // Character set
    .replace(/\x1B[@-_]/g, '')                   // Two-byte ESC sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''); // Control chars (keep \t \n \r)
}

function openLogStream(sessionData) {
  if (!sessionData.logDir) return null;
  try {
    fs.mkdirSync(sessionData.logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const fname = `ssh_${sessionData.host}_${ts}.log`;
    const fpath = path.join(sessionData.logDir, fname);
    const stream = fs.createWriteStream(fpath, { flags: 'a', encoding: 'utf8' });
    const bar = '─'.repeat(64);
    stream.write(`${bar}\n`);
    stream.write(`SSH Session Log\n`);
    stream.write(`Host    : ${sessionData.username}@${sessionData.host}:${sessionData.port}\n`);
    stream.write(`Started : ${new Date().toISOString()}\n`);
    stream.write(`${bar}\n\n`);
    sessionData.logPath = fpath;
    return stream;
  } catch (e) {
    return null;
  }
}

module.exports = async function sshRoutes(fastify) {
  // Store credentials + optional logDir, return sessionId
  fastify.post('/connect', async (req, reply) => {
    const { host, port = 22, username, password, logDir } = req.body;
    if (!host || !username || !password)
      return reply.code(400).send({ error: 'host, username, password required' });

    const sessionId = uuidv4();
    sessions.set(sessionId, {
      host, port: Number(port), username, password,
      logDir: logDir || null,
      logPath: null,
      conn: null,
    });
    return { sessionId };
  });

  fastify.delete('/disconnect/:sessionId', async (req, reply) => {
    const s = sessions.get(req.params.sessionId);
    if (s?.conn) s.conn.end();
    sessions.delete(req.params.sessionId);
    return { ok: true };
  });

  // Download the session log file
  fastify.get('/log/:sessionId', async (req, reply) => {
    const s = sessions.get(req.params.sessionId);
    if (!s) return reply.code(404).send({ error: 'Session not found' });
    if (!s.logPath) return reply.code(404).send({ error: 'Logging not enabled for this session' });
    const stat = fs.statSync(s.logPath, { throwIfNoEntry: false });
    if (!stat) return reply.code(404).send({ error: 'Log file missing' });
    const fname = path.basename(s.logPath);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${fname}"`);
    return reply.send(fs.createReadStream(s.logPath));
  });

  // WebSocket terminal
  fastify.get('/terminal/:sessionId', { websocket: true }, (socket, req) => {
    const sessionData = sessions.get(req.params.sessionId);
    if (!sessionData) {
      socket.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      socket.close();
      return;
    }

    let logStream = openLogStream(sessionData);
    let loggingEnabled = true;

    const conn = new Client();
    sessionData.conn = conn;

    conn.on('ready', () => {
      const msg = { type: 'connected' };
      if (sessionData.logPath) msg.logPath = sessionData.logPath;
      socket.send(JSON.stringify(msg));

      conn.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
        if (err) {
          socket.send(JSON.stringify({ type: 'error', message: err.message }));
          conn.end();
          return;
        }

        function writeLog(data) {
          if (logStream && loggingEnabled) {
            logStream.write(stripAnsi(data.toString()));
          }
        }

        stream.on('data', (data) => {
          socket.send(JSON.stringify({ type: 'data', data: data.toString('base64') }));
          writeLog(data);
        });
        stream.stderr.on('data', (data) => {
          socket.send(JSON.stringify({ type: 'data', data: data.toString('base64') }));
          writeLog(data);
        });

        stream.on('close', () => {
          if (logStream) {
            const bar = '─'.repeat(64);
            logStream.write(`\n\n${bar}\n`);
            logStream.write(`Session ended: ${new Date().toISOString()}\n`);
            logStream.write(`${bar}\n`);
            logStream.end();
            logStream = null;
          }
          socket.send(JSON.stringify({ type: 'closed' }));
          conn.end();
        });

        socket.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'data') {
              stream.write(Buffer.from(msg.data, 'base64'));
            } else if (msg.type === 'resize') {
              stream.setWindow(msg.rows, msg.cols, 0, 0);
            } else if (msg.type === 'log_toggle') {
              loggingEnabled = msg.enable;
              socket.send(JSON.stringify({
                type: 'log_status',
                enabled: loggingEnabled,
                path: sessionData.logPath || null,
              }));
            }
          } catch (_) {}
        });

        socket.on('close', () => {
          stream.close();
          if (logStream) { logStream.end(); logStream = null; }
          conn.end();
        });
      });
    });

    conn.on('error', (err) => {
      socket.send(JSON.stringify({ type: 'error', message: err.message }));
      socket.close();
    });

    conn.connect({
      host: sessionData.host,
      port: sessionData.port,
      username: sessionData.username,
      password: sessionData.password,
    });
  });
};
