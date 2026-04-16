'use strict';
const fs   = require('fs');
const path = require('path');

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

function walkDir(dir) {
  let bytes = 0, count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = walkDir(full);
        bytes += sub.bytes;
        count += sub.count;
      } else {
        try { bytes += fs.statSync(full).size; } catch {}
        count++;
      }
    }
  } catch {}
  return { bytes, count };
}

function clearDir(dir) {
  let freed = 0, count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = walkDir(full);
        freed += sub.bytes;
        count += sub.count;
        try { fs.rmSync(full, { recursive: true, force: true }); } catch {}
      } else {
        try {
          freed += fs.statSync(full).size;
          fs.unlinkSync(full);
          count++;
        } catch {}
      }
    }
  } catch {}
  return { freed, count };
}

module.exports = async function cacheRoutes(fastify) {
  // Accept text/plain from navigator.sendBeacon
  fastify.addContentTypeParser(
    'text/plain', { parseAs: 'string' },
    (req, body, done) => done(null, body),
  );

  fastify.get('/info', async () => walkDir(uploadsDir));

  fastify.post('/clear', async () => {
    const r = clearDir(uploadsDir);
    return { ok: true, freed: r.freed, count: r.count };
  });
};
