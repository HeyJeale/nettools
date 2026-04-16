'use strict';
const http = require('http');
const { v4: uuidv4 } = require('uuid');

// instanceId → { server, port, path, useAuth, sockets: Set, queue: string[] }
const instances = new Map();

function broadcast(instanceId, msg) {
  const inst = instances.get(instanceId);
  if (!inst) return;
  const raw = JSON.stringify(msg);
  let sent = false;
  for (const ws of inst.sockets) {
    if (ws.readyState === 1) { ws.send(raw); sent = true; }
  }
  // Buffer requests that arrive before the WS client connects
  if (!sent && msg.type === 'request') {
    inst.queue.push(raw);
  }
}

module.exports = async function httpServerRoutes(fastify) {

  fastify.post('/start', async (req, reply) => {
    const {
      port = 8080,
      path: listenPath = '/httpServer',
      authUser = '',
      authPass = '',
    } = req.body || {};

    const portNum = Number(port);
    if (!portNum || portNum < 1 || portNum > 65535)
      return reply.code(400).send({ error: 'Invalid port' });

    for (const [id, inst] of instances) {
      if (inst.port === portNum)
        return reply.code(409).send({ error: `Port ${portNum} already in use by instance ${id}` });
    }

    const instanceId = uuidv4();
    const normPath = listenPath.startsWith('/') ? listenPath : `/${listenPath}`;
    const useAuth = !!(authUser && authPass);

    const server = http.createServer((httpReq, httpRes) => {
      const reqPath = httpReq.url.split('?')[0];
      if (normPath !== '/' && reqPath !== normPath) {
        httpRes.writeHead(404, { 'Content-Type': 'text/plain' });
        httpRes.end('Not Found');
        return;
      }

      if (useAuth) {
        const authHeader = httpReq.headers['authorization'] || '';
        const expected = 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64');
        if (authHeader !== expected) {
          httpRes.writeHead(401, {
            'Content-Type': 'text/plain',
            'WWW-Authenticate': 'Basic realm="NetTools HTTP Server"',
          });
          httpRes.end('Unauthorized');
          return;
        }
      }

      const chunks = [];
      httpReq.on('data', c => chunks.push(c));
      httpReq.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);
        let bodyText = bodyBuf.toString('utf8');

        const ct = httpReq.headers['content-type'] || '';
        if (ct.includes('json')) {
          try { bodyText = JSON.stringify(JSON.parse(bodyText), null, 2); } catch {}
        }

        broadcast(instanceId, {
          type: 'request',
          id: uuidv4(),
          ts: new Date().toISOString(),
          method: httpReq.method,
          url: httpReq.url,
          headers: httpReq.headers,
          body: bodyText,
          bodySize: bodyBuf.byteLength,
        });

        httpRes.writeHead(200, { 'Content-Type': 'text/plain' });
        httpRes.end('OK');
      });

      httpReq.on('error', () => {
        try { httpRes.writeHead(400).end('Bad Request'); } catch {}
      });
    });

    // Register BEFORE listen so broadcast() can find the instance immediately
    instances.set(instanceId, {
      server,
      port: portNum,
      path: normPath,
      useAuth,
      sockets: new Set(),
      queue: [],
    });

    await new Promise((resolve, reject) => {
      server.listen(portNum, '0.0.0.0', () => resolve());
      server.once('error', reject);
    }).catch(err => {
      instances.delete(instanceId);
      const e = new Error(err.message);
      e.statusCode = 500;
      throw e;
    });

    return { instanceId, port: portNum, path: normPath };
  });

  async function stopInstance(id, reply) {
    const inst = instances.get(id);
    if (!inst) return reply.code(404).send({ error: 'Instance not found' });
    const raw = JSON.stringify({ type: 'stopped' });
    for (const ws of inst.sockets) {
      if (ws.readyState === 1) ws.send(raw);
      ws.close();
    }
    await new Promise(r => inst.server.close(r));
    instances.delete(id);
    return { ok: true };
  }

  fastify.delete('/stop/:instanceId', (req, reply) => stopInstance(req.params.instanceId, reply));
  fastify.post('/stop/:instanceId',   (req, reply) => stopInstance(req.params.instanceId, reply));

  fastify.get('/stream/:instanceId', { websocket: true }, (socket, req) => {
    const inst = instances.get(req.params.instanceId);
    if (!inst) {
      socket.send(JSON.stringify({ type: 'error', message: 'Instance not found' }));
      socket.close();
      return;
    }

    inst.sockets.add(socket);
    socket.send(JSON.stringify({ type: 'connected', port: inst.port, path: inst.path }));

    // Flush buffered requests that arrived before this socket connected
    for (const raw of inst.queue) socket.send(raw);
    inst.queue = [];

    socket.on('close', () => inst.sockets.delete(socket));
  });
};
