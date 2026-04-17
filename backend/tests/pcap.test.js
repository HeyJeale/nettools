'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const fastify = require('fastify');

// Mock parsePcap so we don't depend on the ESM pcap-ng-parser package.
// Load pure functions (filterPackets, getStats, getTimeline) via vm to avoid
// the ESM import in pcapParser.js, then override parsePcap with a jest.fn().
jest.mock('../src/services/pcapParser', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const src = fs.readFileSync(
    path.join(__dirname, '../src/services/pcapParser.js'),
    'utf8'
  ).replace("require('@cto.af/pcap-ng-parser')", '{ PCAPNGParser: class {} }');
  const mod = { exports: {} };
  const context = vm.createContext({
    module: mod,
    exports: mod.exports,
    require,
    Buffer,
    process,
    console,
    __dirname: path.join(__dirname, '../src/services'),
    __filename: path.join(__dirname, '../src/services/pcapParser.js'),
  });
  vm.runInContext(src, context);
  return {
    ...mod.exports,
    parsePcap: jest.fn(),
  };
});

const { parsePcap } = require('../src/services/pcapParser');

// Minimal fake packet set: 2 ARP + 1 TCP + 1 DNS
const FAKE_PACKETS = [
  { pktIndex: 0, ts: 1.0, protocol: 'ARP',  srcIP: '192.168.1.1', dstIP: '192.168.1.2', srcPort: null, dstPort: null, len: 42, summary: 'ARP request', rawHex: 'aa', payloadAscii: '' },
  { pktIndex: 1, ts: 2.0, protocol: 'ARP',  srcIP: '192.168.1.3', dstIP: '192.168.1.4', srcPort: null, dstPort: null, len: 42, summary: 'ARP request', rawHex: 'bb', payloadAscii: '' },
  { pktIndex: 2, ts: 0.5, protocol: 'TCP',  srcIP: '10.0.0.1',    dstIP: '10.0.0.2',    srcPort: 54321, dstPort: 80,  len: 54, summary: 'TCP SYN', rawHex: 'cc', payloadAscii: '' },
  { pktIndex: 3, ts: 3.0, protocol: 'DNS',  srcIP: '10.0.0.1',    dstIP: '8.8.8.8',     srcPort: 12345, dstPort: 53,  len: 42, summary: 'DNS query', rawHex: 'dd', payloadAscii: '' },
];

describe('pcap routes', () => {
  let tmpDir;
  let app;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nettools-pcap-test-'));
    process.env.UPLOADS_DIR = tmpDir;
    const instance = fastify({ logger: false });
    instance.register(require('@fastify/multipart'), { limits: { fileSize: 200 * 1024 * 1024 } });
    instance.register(require('../src/routes/pcap'), { prefix: '/api/pcap' });
    await instance.ready();
    app = instance;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  beforeEach(() => {
    parsePcap.mockResolvedValue(FAKE_PACKETS.map((p, i) => ({ ...p, pktIndex: i })));
    // Clean up uploaded files from previous test so dir stays predictable
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function uploadFile() {
    const boundary = '----TestBoundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pcapng"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from('fake pcap content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/pcap/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  test('POST /upload returns pcapId and total packet count', async () => {
    const body = await uploadFile();
    expect(body.pcapId).toBeDefined();
    expect(body.total).toBe(4);
  });

  test('POST /upload with no file returns 400', async () => {
    const boundary = '----TestBoundary';
    const res = await app.inject({
      method: 'POST',
      url: '/api/pcap/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(`--${boundary}--\r\n`),
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST /upload returns 422 when parsePcap throws', async () => {
    parsePcap.mockRejectedValueOnce(new Error('corrupt file'));
    const boundary = '----TestBoundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bad.pcapng"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from('not a pcap'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/pcap/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error).toMatch('corrupt file');
  });

  test('GET /:pcapId/packets returns all packets', async () => {
    const { pcapId } = await uploadFile();
    const res = await app.inject({ method: 'GET', url: `/api/pcap/${pcapId}/packets` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(4);
    expect(body.packets).toHaveLength(4);
  });

  test('GET /:pcapId/packets with protocol filter', async () => {
    const { pcapId } = await uploadFile();
    const res = await app.inject({ method: 'GET', url: `/api/pcap/${pcapId}/packets?filter=arp` });
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.packets.every(p => p.protocol === 'ARP')).toBe(true);
  });

  test('GET /:pcapId/packets pagination', async () => {
    const { pcapId } = await uploadFile();
    const res = await app.inject({ method: 'GET', url: `/api/pcap/${pcapId}/packets?page=1&limit=2` });
    const body = JSON.parse(res.body);
    expect(body.packets).toHaveLength(2);
    expect(body.pageSize).toBe(2);
    expect(body.total).toBe(4);
  });

  test('GET /:pcapId/packets unknown id returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pcap/nonexistent/packets' });
    expect(res.statusCode).toBe(404);
  });

  test('GET /:pcapId/stats returns protocol counts', async () => {
    const { pcapId } = await uploadFile();
    const res = await app.inject({ method: 'GET', url: `/api/pcap/${pcapId}/stats` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(4);
    expect(body.byProtocol.ARP).toBe(2);
    expect(body.byProtocol.DNS).toBe(1);
  });

  test('GET /:pcapId/timeline returns bucket array', async () => {
    const { pcapId } = await uploadFile();
    const res = await app.inject({ method: 'GET', url: `/api/pcap/${pcapId}/timeline?buckets=10` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.timeline).toHaveLength(10);
  });

  test('GET /:pcapId/packet/:index returns packet detail', async () => {
    const { pcapId } = await uploadFile();
    const res = await app.inject({ method: 'GET', url: `/api/pcap/${pcapId}/packet/0` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.protocol).toBe('ARP');
    expect(body.rawHex).toBeDefined();
  });

  test('GET /:pcapId/packet/:index out of range returns 404', async () => {
    const { pcapId } = await uploadFile();
    const res = await app.inject({ method: 'GET', url: `/api/pcap/${pcapId}/packet/999` });
    expect(res.statusCode).toBe(404);
  });

  test('DELETE /:pcapId removes from store and disk', async () => {
    const { pcapId } = await uploadFile();
    const del = await app.inject({ method: 'DELETE', url: `/api/pcap/${pcapId}` });
    expect(del.statusCode).toBe(200);
    expect(JSON.parse(del.body).ok).toBe(true);
    // Subsequent request should 404
    const res = await app.inject({ method: 'GET', url: `/api/pcap/${pcapId}/packets` });
    expect(res.statusCode).toBe(404);
    // Specific file should be gone from disk
    expect(fs.existsSync(path.join(tmpDir, `${pcapId}.pcap`))).toBe(false);
  });

  test('DELETE unknown id still returns ok', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/pcap/does-not-exist' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });
});
