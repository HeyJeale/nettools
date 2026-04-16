'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

// instanceId → { server, port, path, useAuth, authUser, authPass, records, sockets, queue }
const instances = new Map();

function broadcast(instanceId, msg) {
  const inst = instances.get(instanceId);
  if (!inst) return;
  const raw = JSON.stringify(msg);
  let sent = false;
  for (const ws of inst.sockets) {
    if (ws.readyState === 1) { ws.send(raw); sent = true; }
  }
  if (!sent && msg.type === 'record') inst.queue.push(raw);
}

module.exports = async function anprRoutes(fastify) {

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
    const imgDir = path.join(uploadsDir, 'anpr', instanceId);
    fs.mkdirSync(imgDir, { recursive: true });

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
            'WWW-Authenticate': 'Basic realm="NetTools ANPR Server"',
          });
          httpRes.end('Unauthorized');
          return;
        }
      }

      if (httpReq.method !== 'POST') {
        httpRes.writeHead(405, { 'Content-Type': 'text/plain' });
        httpRes.end('Method Not Allowed');
        return;
      }

      const chunks = [];
      httpReq.on('data', c => chunks.push(c));
      httpReq.on('end', () => {
        let record = null;
        try {
          record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          httpRes.writeHead(400, { 'Content-Type': 'text/plain' });
          httpRes.end('Bad Request: invalid JSON');
          return;
        }

        const entryId = uuidv4();
        let imageCount = 0;

        // Write images to disk; strip base64 from memory
        const plateB64 = record.plate_image ?? null;
        const fullB64  = record.full_image  ?? null;
        if (plateB64) {
          try {
            fs.writeFileSync(path.join(imgDir, `${entryId}_0.jpg`), Buffer.from(plateB64, 'base64'));
            imageCount++;
          } catch {}
        }
        if (fullB64) {
          try {
            fs.writeFileSync(path.join(imgDir, `${entryId}_1.jpg`), Buffer.from(fullB64, 'base64'));
            imageCount++;
          } catch {}
        }

        const entry = {
          id:              entryId,
          ts:              new Date().toISOString(),
          device:          record.device           ?? null,
          time:            record.time             ?? null,
          timeMsec:        record.time_msec        ?? null,
          plate:           record.plate            ?? null,
          type:            record.type             ?? null,
          speed:           record.speed            ?? null,
          direction:       record.direction        ?? null,
          detectionRegion: record.detection_region ?? null,
          region:          record.region           ?? null,
          resolutionWidth: record.resolution_width ?? null,
          resolutionHeight:record.resolution_height ?? null,
          coordinateX1:    record.coordinate_x1    ?? null,
          coordinateY1:    record.coordinate_y1    ?? null,
          coordinateX2:    record.coordinate_x2    ?? null,
          coordinateY2:    record.coordinate_y2    ?? null,
          confidence:      record.confidence       ?? null,
          plateColor:      record.plate_color      ?? null,
          vehicleType:     record.vehicle_type     ?? null,
          vehicleColor:    record.vehicle_color    ?? null,
          vehicleBrand:    record['Vehicle Brand'] ?? null,
          imageCount,
        };

        const inst = instances.get(instanceId);
        if (inst) inst.records.push(entry);

        broadcast(instanceId, { type: 'record', record: entry });

        httpRes.writeHead(200, { 'Content-Type': 'text/plain' });
        httpRes.end('OK');
      });

      httpReq.on('error', () => {
        try { httpRes.writeHead(400).end('Bad Request'); } catch {}
      });
    });

    instances.set(instanceId, {
      server, port: portNum, path: normPath,
      useAuth, authUser, authPass,
      records: [], sockets: new Set(), queue: [],
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
    // Clean up image files for this instance
    try { fs.rmSync(path.join(uploadsDir, 'anpr', id), { recursive: true, force: true }); } catch {}
    return { ok: true };
  }

  fastify.delete('/stop/:instanceId', (req, reply) => stopInstance(req.params.instanceId, reply));
  fastify.post('/stop/:instanceId',   (req, reply) => stopInstance(req.params.instanceId, reply));

  // Get stored records with optional pagination (?offset=&limit=)
  fastify.get('/records/:instanceId', async (req, reply) => {
    const inst = instances.get(req.params.instanceId);
    if (!inst) return reply.code(404).send({ error: 'Instance not found' });
    const total  = inst.records.length;
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Number(req.query.offset) || 0;
    return { records: inst.records.slice(offset, offset + limit), total };
  });

  // Clear stored records and their images
  fastify.delete('/records/:instanceId', async (req, reply) => {
    const inst = instances.get(req.params.instanceId);
    if (!inst) return reply.code(404).send({ error: 'Instance not found' });
    inst.records = [];
    const imgDir = path.join(uploadsDir, 'anpr', req.params.instanceId);
    try {
      for (const f of fs.readdirSync(imgDir)) {
        try { fs.unlinkSync(path.join(imgDir, f)); } catch {}
      }
    } catch {}
    return { ok: true };
  });

  // Serve a stored image
  fastify.get('/image/:instanceId/:recordId/:index', async (req, reply) => {
    const { instanceId, recordId, index } = req.params;
    const filePath = path.join(uploadsDir, 'anpr', instanceId, `${recordId}_${index}.jpg`);
    try {
      const data = fs.readFileSync(filePath);
      return reply.type('image/jpeg').send(data);
    } catch {
      return reply.code(404).send({ error: 'Image not found' });
    }
  });

  // WebSocket stream
  fastify.get('/stream/:instanceId', { websocket: true }, (socket, req) => {
    const inst = instances.get(req.params.instanceId);
    if (!inst) {
      socket.send(JSON.stringify({ type: 'error', message: 'Instance not found' }));
      socket.close();
      return;
    }

    inst.sockets.add(socket);
    socket.send(JSON.stringify({ type: 'connected', port: inst.port, path: inst.path }));

    // Flush buffered records that arrived before this socket connected
    for (const raw of inst.queue) socket.send(raw);
    inst.queue = [];

    socket.on('close', () => inst.sockets.delete(socket));
  });
};
