'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const fastify = require('fastify');

function buildApp(uploadsDir) {
  const app = fastify({ logger: false });
  // Override UPLOADS_DIR for the route module
  process.env.UPLOADS_DIR = uploadsDir;
  // Re-require to pick up the env var (Jest caches modules, so we use a fresh instance)
  const cacheRoutes = require('../src/routes/cache');
  app.register(cacheRoutes, { prefix: '/api/cache' });
  return app;
}

describe('cache routes', () => {
  let tmpDir;
  let app;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nettools-test-'));
    app = buildApp(tmpDir);
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
    // Clear Jest module cache so each test gets a fresh route with the new UPLOADS_DIR
    jest.resetModules();
  });

  test('GET /api/cache/info returns 0 bytes for empty dir', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cache/info' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.bytes).toBe(0);
    expect(body.count).toBe(0);
  });

  test('GET /api/cache/info counts files correctly', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.pcap'), Buffer.alloc(100));
    fs.writeFileSync(path.join(tmpDir, 'b.pcap'), Buffer.alloc(200));
    const res = await app.inject({ method: 'GET', url: '/api/cache/info' });
    const body = JSON.parse(res.body);
    expect(body.count).toBe(2);
    expect(body.bytes).toBe(300);
  });

  test('GET /api/cache/info counts files in subdirectories', async () => {
    const sub = path.join(tmpDir, 'anpr');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(tmpDir, 'root.pcap'), Buffer.alloc(50));
    fs.writeFileSync(path.join(sub, 'img.jpg'), Buffer.alloc(150));
    const res = await app.inject({ method: 'GET', url: '/api/cache/info' });
    const body = JSON.parse(res.body);
    expect(body.count).toBe(2);
    expect(body.bytes).toBe(200);
  });

  test('POST /api/cache/clear deletes files and returns freed bytes', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.pcap'), Buffer.alloc(512));
    fs.writeFileSync(path.join(tmpDir, 'b.pcap'), Buffer.alloc(256));
    const res = await app.inject({ method: 'POST', url: '/api/cache/clear' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.freed).toBe(768);
    expect(body.count).toBe(2);
    // Files should be gone
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  test('POST /api/cache/clear on empty dir returns 0', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/cache/clear' });
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.freed).toBe(0);
    expect(body.count).toBe(0);
  });

  test('POST /api/cache/clear calls clearPcapStore option', async () => {
    const clearPcapStore = jest.fn();
    const app2 = fastify({ logger: false });
    process.env.UPLOADS_DIR = tmpDir;
    app2.register(require('../src/routes/cache'), {
      prefix: '/api/cache',
      clearPcapStore,
    });
    await app2.inject({ method: 'POST', url: '/api/cache/clear' });
    expect(clearPcapStore).toHaveBeenCalledTimes(1);
    await app2.close();
  });
});
