'use strict';
// Thin shim that drives tsharkAdapter and persists results to pcapDb.
// Routes call parsePcap() on upload, then query pcapDb directly.

const { parsePcap: runTshark, filterFrames, readLinkType } = require('./tsharkAdapter');
const db = require('./pcapDb');

async function parsePcap(filePath, pcapId) {
  const linkType = readLinkType(filePath);
  let total = 0;
  const onBatch = (rows) => {
    db.batchInsert(pcapId, rows);
    total += rows.length;
  };
  await runTshark(filePath, { onBatch });
  db.insertPcap({ id: pcapId, filePath, total, linkType });
  return { total };
}

module.exports = { parsePcap, filterFrames };
