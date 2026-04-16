'use strict';
const net  = require('net');
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

// ── Enum lookup tables (from Java enums) ─────────────────────────────────────
const LPR_COLOR = {
  0:'Unknown',1:'Black',2:'Blue',3:'Cyan',4:'Gray',5:'Green',
  6:'Red',7:'White',8:'Yellow',9:'Violet',10:'Orange',
};
const VEHICLE_TYPE = {
  0:'none',1:'car',2:'motor',3:'bus',4:'truck',5:'van',6:'suv',
  7:'forklift',8:'excavator',9:'tow truck',10:'Police-car',
  11:'fire engine',12:'ambulance',13:'bicycle',14:'E-bike',15:'other',
};
const BRAND_TYPE = {
  0:'Unknown',1:'Audi',2:'Aston Martin',3:'Alfa Romeo',4:'Buick',
  5:'Mercedes-Benz',6:'BMW',7:'Honda',8:'Peugeot',9:'Porsche',
  10:'Bentley',11:'Bugatti',12:'Volkswagen',13:'Dodge',14:'Daewoo',
  15:'Daihatsu',16:'Toyota',17:'Ford',18:'Ferrari',19:'Fiat',
  20:'GMC',21:'Mitsuoka',22:'Haval',23:'Geely',24:'Jeep',
  25:'Jaguar',26:'Cadillac',27:'Chrysler',28:'Lexus',29:'Land Rover',
  30:'Lincoln',31:'Suzuki',32:'Rolls-Royce',33:'Lamborghini',34:'Renault',
  35:'Mazda',36:'MINI',37:'Maserati',38:'Maybach',39:'Acura',
  40:'Opel',41:'Chery',42:'Kia',43:'Nissan',44:'Skoda',
  45:'Mitsubishi',46:'Subaru',47:'Smart',48:'Ssangyong',49:'Tesla',
  50:'Isuzu',51:'Chevrolet',52:'Citroen',53:'Hyundai',54:'Infinity',
  55:'Mercury',56:'Saturn',57:'Saab',58:'Lynk&Co',59:'Morris Garages',
  60:'Pagani',61:'Spyker',62:'BYD',63:'McLaren',64:'Koenigsegg',
  65:'Volvo',66:'Lancia',67:'Shelby',68:'Seat',69:'Cupra',
  70:'Dacia',71:'DS',
};

// ── Protocol constants ────────────────────────────────────────────────────────
const SIGNAL_LOGIN_REQ   = 0x0001;
const SIGNAL_LOGIN_RPL   = 0x8001;
const SIGNAL_RECOGNITION = 0x8801;
const METADATA_HEADER = Buffer.from([0x00, 0x00, 0xFF, 0x11]);
const IMAGE_HEADER_LE  = 0x22FF0000; // read as uint32 LE → bytes [0x00,0x00,0xFF,0x22]

// ── Frame helpers ─────────────────────────────────────────────────────────────
function findFrameStart(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xFF && buf[i + 1] === 0xCC) return i;
  }
  return -1;
}

function buildLoginPacket(username, password) {
  const json = JSON.stringify({ id: username, password });
  const jsonBuf = Buffer.from(json, 'utf8');
  const pkt = Buffer.allocUnsafe(2 + 2 + 4 + jsonBuf.length + 2);
  let o = 0;
  pkt[o++] = 0xFF; pkt[o++] = 0xCC;
  pkt.writeUInt16LE(SIGNAL_LOGIN_REQ, o); o += 2;
  pkt.writeInt32LE(jsonBuf.length + 2, o); o += 4;
  jsonBuf.copy(pkt, o); o += jsonBuf.length;
  pkt[o++] = 0xDD; pkt[o++] = 0xFF;
  return pkt;
}

// ── LPR frame parser — returns image Buffers (not base64) ────────────────────
function parseLPRFrame(frame) {
  let offset = 6;

  if (frame[offset] !== 0x00 || frame[offset+1] !== 0x00 ||
      frame[offset+2] !== 0xFF || frame[offset+3] !== 0x11) {
    throw new Error('Invalid metadata chunk header');
  }
  offset += 4;

  const metadataLength = frame.readInt32LE(offset); offset += 4;
  const meta = frame.slice(offset, offset + metadataLength);
  offset += metadataLength;

  let mo = 0;

  const guid = meta.toString('utf8', mo, mo + 16).replace(/\0/g, ''); mo += 16;

  const tsLo = meta.readUInt32LE(mo);
  const tsHi = meta.readUInt32LE(mo + 4);
  const tsMs = tsHi * 0x100000000 + tsLo;
  mo += 8;

  mo += 16; // deprecated plate field

  const vehicleColor = LPR_COLOR[meta[mo]] || 'Unknown'; mo++;
  const plateColor   = LPR_COLOR[meta[mo]] || 'Unknown'; mo++;

  const speedRaw = meta.readUInt16LE(mo); mo += 2;
  const speed = speedRaw === 65535 ? 'Invalid' : speedRaw;

  const imageCount = meta[mo]; mo++;
  const direction  = meta[mo]; mo++;

  const region = meta.toString('utf8', mo, mo + 32).replace(/\0/g, ''); mo += 32;

  const roiNumber   = meta[mo]; mo++;
  const plateLength = meta[mo]; mo++;
  const plate = meta.toString('utf8', mo, mo + plateLength); mo += plateLength;

  const vehicleType = VEHICLE_TYPE[meta[mo]] || 'none'; mo++;

  const confidence = meta.readFloatLE(mo).toFixed(2); mo += 4;

  const plateType = meta[mo]; mo++;

  const distance = meta.readInt32LE(mo); mo += 4;

  const azimuth = meta.readInt16LE(mo); mo += 4;

  const vehicleCount = meta.readInt32LE(mo); mo += 4;

  const width  = meta.readUInt16LE(mo); mo += 2;
  const height = meta.readUInt16LE(mo); mo += 2;
  const x1 = meta.readUInt16LE(mo); mo += 2;
  const y1 = meta.readUInt16LE(mo); mo += 2;
  const x2 = meta.readUInt16LE(mo); mo += 2;
  const y2 = meta.readUInt16LE(mo); mo += 2;

  const brandCode = meta.readUInt16LE(mo); mo += 2;
  const brand = BRAND_TYPE[brandCode] || 'Unknown';

  // Parse image chunks — return raw Buffers (caller writes to disk)
  const imageBuffers = [];
  if (imageCount > 0 && offset < frame.length) {
    const imgBuf = frame.slice(offset);
    let io = 0;
    for (let i = 0; i < imageCount && io + 8 <= imgBuf.length; i++) {
      const imgHeader = imgBuf.readUInt32LE(io); io += 4;
      if (imgHeader !== IMAGE_HEADER_LE) break;
      const imgSize = imgBuf.readUInt32LE(io); io += 4;
      if (io + imgSize > imgBuf.length) break;
      imageBuffers.push(imgBuf.slice(io, io + imgSize));
      io += imgSize;
    }
  }

  return {
    id: uuidv4(),
    guid, tsMs,
    time: new Date(tsMs).toLocaleString('zh-CN', { hour12: false }),
    vehicleColor, plateColor, speed, direction, region, roiNumber,
    plate, vehicleType, confidence, plateType, distance, azimuth,
    vehicleCount, width, height, x1, y1, x2, y2, brand,
    imageCount: imageBuffers.length,
    imageBuffers, // temporary — stripped before storing/broadcasting
  };
}

// ── Connection store ──────────────────────────────────────────────────────────
// connId → { socket, host, port, state, records, sockets, queue, rxBuf }
const connections = new Map();

function broadcast(connId, msg) {
  const conn = connections.get(connId);
  if (!conn) return;
  const raw = JSON.stringify(msg);
  let sent = false;
  for (const ws of conn.sockets) {
    if (ws.readyState === 1) { ws.send(raw); sent = true; }
  }
  if (!sent && (msg.type === 'record' || msg.type === 'status')) conn.queue.push(raw);
}

function processRxBuf(connId) {
  const conn = connections.get(connId);
  if (!conn) return;

  while (true) {
    const start = findFrameStart(conn.rxBuf);
    if (start === -1 || conn.rxBuf.length < start + 8) break;

    const signal     = conn.rxBuf.readUInt16LE(start + 2);
    const lengthInfo = conn.rxBuf.readInt32LE(start + 4);
    const dataLength = lengthInfo - 2;
    const frameTotalLength = 2 + 6 + dataLength;

    if (conn.rxBuf.length < start + frameTotalLength) break;

    const frame = conn.rxBuf.slice(start + 2, start + frameTotalLength);
    conn.rxBuf = conn.rxBuf.slice(start + frameTotalLength);

    handleFrame(connId, frame, signal, dataLength);
  }
}

function handleFrame(connId, frame, signal, dataLength) {
  const conn = connections.get(connId);
  if (!conn) return;

  if (signal === SIGNAL_LOGIN_RPL) {
    const json = frame.slice(6, 6 + dataLength).toString('utf8');
    if (json.includes('200')) {
      conn.state = 'authenticated';
      broadcast(connId, { type: 'status', state: 'authenticated' });
    } else {
      broadcast(connId, { type: 'auth_failed', message: 'Authentication failed' });
    }
  } else if (signal === SIGNAL_RECOGNITION) {
    try {
      const record = parseLPRFrame(frame);

      // Write image buffers to disk, strip from record
      const imgDir = path.join(uploadsDir, 'lpr', connId);
      const { imageBuffers } = record;
      delete record.imageBuffers;
      imageBuffers.forEach((buf, i) => {
        try { fs.writeFileSync(path.join(imgDir, `${record.id}_${i}.jpg`), buf); } catch {}
      });

      conn.records.push(record);
      broadcast(connId, { type: 'record', record });
    } catch (err) {
      console.error('[tcpLprClient] parse error:', err.message);
    }
  }
}

// ── Fastify routes ────────────────────────────────────────────────────────────
module.exports = async function tcpLprRoutes(fastify) {

  fastify.post('/connect', async (req, reply) => {
    const { host = '', port = 0 } = req.body || {};
    const portNum = Number(port);
    if (!host) return reply.code(400).send({ error: 'host required' });
    if (!portNum || portNum < 1 || portNum > 65535)
      return reply.code(400).send({ error: 'invalid port' });

    const connId = uuidv4();

    // Create image directory for this connection
    fs.mkdirSync(path.join(uploadsDir, 'lpr', connId), { recursive: true });

    const conn = {
      socket: null, host, port: portNum,
      state: 'connected',
      records: [], sockets: new Set(), queue: [],
      rxBuf: Buffer.alloc(0),
    };

    await new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port: portNum }, () => resolve());
      sock.once('error', reject);

      sock.on('data', chunk => {
        conn.rxBuf = Buffer.concat([conn.rxBuf, chunk]);
        processRxBuf(connId);
      });

      sock.on('close', () => {
        conn.state = 'disconnected';
        broadcast(connId, { type: 'disconnected' });
      });

      sock.on('error', err => {
        broadcast(connId, { type: 'error', message: err.message });
      });

      conn.socket = sock;
    }).catch(err => {
      try { fs.rmSync(path.join(uploadsDir, 'lpr', connId), { recursive: true, force: true }); } catch {}
      const e = new Error(err.message);
      e.statusCode = 500;
      throw e;
    });

    connections.set(connId, conn);
    return { connId, host, port: portNum };
  });

  fastify.post('/auth/:connId', async (req, reply) => {
    const conn = connections.get(req.params.connId);
    if (!conn) return reply.code(404).send({ error: 'Connection not found' });
    const { username = '', password = '' } = req.body || {};
    if (!username || !password)
      return reply.code(400).send({ error: 'username and password required' });

    try {
      conn.socket.write(buildLoginPacket(username, password));
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
    return { ok: true };
  });

  async function disconnectConn(id, reply) {
    const conn = connections.get(id);
    if (!conn) return reply.code(404).send({ error: 'Connection not found' });
    try { conn.socket.destroy(); } catch {}
    for (const ws of conn.sockets) {
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'disconnected' })); ws.close(); } catch {}
    }
    connections.delete(id);
    // Clean up image files for this connection
    try { fs.rmSync(path.join(uploadsDir, 'lpr', id), { recursive: true, force: true }); } catch {}
    return { ok: true };
  }

  fastify.delete('/disconnect/:connId', (req, reply) => disconnectConn(req.params.connId, reply));
  fastify.post('/disconnect/:connId',   (req, reply) => disconnectConn(req.params.connId, reply));

  // Get stored records with optional pagination (?offset=&limit=)
  fastify.get('/records/:connId', async (req, reply) => {
    const conn = connections.get(req.params.connId);
    if (!conn) return reply.code(404).send({ error: 'Connection not found' });
    const total  = conn.records.length;
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Number(req.query.offset) || 0;
    return { records: conn.records.slice(offset, offset + limit), total };
  });

  // Clear stored records and their images
  fastify.delete('/records/:connId', async (req, reply) => {
    const conn = connections.get(req.params.connId);
    if (!conn) return reply.code(404).send({ error: 'Connection not found' });
    conn.records = [];
    const imgDir = path.join(uploadsDir, 'lpr', req.params.connId);
    try {
      for (const f of fs.readdirSync(imgDir)) {
        try { fs.unlinkSync(path.join(imgDir, f)); } catch {}
      }
    } catch {}
    return { ok: true };
  });

  // Serve a stored image
  fastify.get('/image/:connId/:recordId/:index', async (req, reply) => {
    const { connId, recordId, index } = req.params;
    const filePath = path.join(uploadsDir, 'lpr', connId, `${recordId}_${index}.jpg`);
    try {
      const data = fs.readFileSync(filePath);
      return reply.type('image/jpeg').send(data);
    } catch {
      return reply.code(404).send({ error: 'Image not found' });
    }
  });

  // WebSocket stream
  fastify.get('/stream/:connId', { websocket: true }, (socket, req) => {
    const conn = connections.get(req.params.connId);
    if (!conn) {
      socket.send(JSON.stringify({ type: 'error', message: 'Connection not found' }));
      socket.close();
      return;
    }

    conn.sockets.add(socket);
    socket.send(JSON.stringify({ type: 'connected', state: conn.state, host: conn.host, port: conn.port }));

    for (const raw of conn.queue) socket.send(raw);
    conn.queue = [];

    socket.on('close', () => conn.sockets.delete(socket));
  });
};
