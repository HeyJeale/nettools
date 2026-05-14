'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pcaps (
  id              TEXT PRIMARY KEY,
  file_path       TEXT NOT NULL,
  total           INTEGER NOT NULL,
  link_type       INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packets (
  pcap_id            TEXT NOT NULL,
  pkt_index          INTEGER NOT NULL,
  ts                 REAL NOT NULL,
  protocol           TEXT,
  src_ip             TEXT,
  dst_ip             TEXT,
  src_port           INTEGER,
  dst_port           INTEGER,
  len                INTEGER,
  summary            TEXT,
  http_pair_index    INTEGER,
  http_kind          TEXT,
  is_onvif           INTEGER,
  onvif_action       TEXT,
  tcp_continuation   INTEGER,
  reassembly_head    INTEGER,
  tcp_anomaly        TEXT,
  PRIMARY KEY (pcap_id, pkt_index)
);

CREATE TABLE IF NOT EXISTS packet_blobs (
  pcap_id      TEXT NOT NULL,
  pkt_index    INTEGER NOT NULL,
  full_json    TEXT NOT NULL,
  PRIMARY KEY (pcap_id, pkt_index)
);

CREATE INDEX IF NOT EXISTS idx_protocol ON packets(pcap_id, protocol);
CREATE INDEX IF NOT EXISTS idx_src_ip   ON packets(pcap_id, src_ip);
CREATE INDEX IF NOT EXISTS idx_dst_ip   ON packets(pcap_id, dst_ip);
CREATE INDEX IF NOT EXISTS idx_ts       ON packets(pcap_id, ts);
CREATE INDEX IF NOT EXISTS idx_onvif    ON packets(pcap_id, is_onvif);
`;

let db = null;

function init(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF');
  db.exec(SCHEMA);
  return db;
}

function getDb() {
  if (!db) throw new Error('pcapDb not initialized');
  return db;
}

function insertPcap(meta) {
  getDb().prepare(`
    INSERT OR REPLACE INTO pcaps (id, file_path, total, link_type, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(meta.id, meta.filePath, meta.total, meta.linkType ?? null, Date.now());
}

const insertPacketStmt = () => getDb().prepare(`
  INSERT OR REPLACE INTO packets
    (pcap_id, pkt_index, ts, protocol, src_ip, dst_ip, src_port, dst_port,
     len, summary, http_pair_index, http_kind, is_onvif, onvif_action,
     tcp_continuation, reassembly_head, tcp_anomaly)
  VALUES (@pcap_id, @pkt_index, @ts, @protocol, @src_ip, @dst_ip, @src_port, @dst_port,
          @len, @summary, @http_pair_index, @http_kind, @is_onvif, @onvif_action,
          @tcp_continuation, @reassembly_head, @tcp_anomaly)
`);

const insertBlobStmt = () => getDb().prepare(`
  INSERT OR REPLACE INTO packet_blobs (pcap_id, pkt_index, full_json)
  VALUES (?, ?, ?)
`);

function batchInsert(pcapId, rows) {
  const ins = insertPacketStmt();
  const insBlob = insertBlobStmt();
  const txn = getDb().transaction((items) => {
    for (const item of items) {
      ins.run({
        pcap_id: pcapId,
        pkt_index: item.pktIndex,
        ts: item.ts,
        protocol: item.protocol,
        src_ip: item.srcIP ?? null,
        dst_ip: item.dstIP ?? null,
        src_port: item.srcPort ?? null,
        dst_port: item.dstPort ?? null,
        len: item.len,
        summary: item.summary ?? null,
        http_pair_index: item.httpPairIndex ?? null,
        http_kind: item.http?.kind ?? null,
        is_onvif: item.http?.isOnvif ? 1 : 0,
        onvif_action: item.http?.onvifAction ?? null,
        tcp_continuation: item.tcpContinuation ? 1 : 0,
        reassembly_head: item.reassemblyHead ?? null,
        tcp_anomaly: item.tcpAnomaly ?? null,
      });
      insBlob.run(pcapId, item.pktIndex, JSON.stringify(item));
    }
  });
  txn(rows);
}

function listPackets(pcapId, { limit = 100, offset = 0, indexes = null } = {}) {
  const d = getDb();
  const total = indexes
    ? indexes.length
    : d.prepare('SELECT COUNT(*) AS c FROM packets WHERE pcap_id = ?').get(pcapId).c;

  let rows;
  if (indexes) {
    const slice = indexes.slice(offset, offset + limit);
    if (!slice.length) return { total, rows: [] };
    const placeholders = slice.map(() => '?').join(',');
    rows = d.prepare(`
      SELECT * FROM packets WHERE pcap_id = ? AND pkt_index IN (${placeholders})
      ORDER BY pkt_index
    `).all(pcapId, ...slice);
  } else {
    rows = d.prepare(`
      SELECT * FROM packets WHERE pcap_id = ?
      ORDER BY pkt_index LIMIT ? OFFSET ?
    `).all(pcapId, limit, offset);
  }
  return { total, rows };
}

function getPacketBlob(pcapId, pktIndex) {
  const row = getDb().prepare(`
    SELECT full_json FROM packet_blobs WHERE pcap_id = ? AND pkt_index = ?
  `).get(pcapId, pktIndex);
  return row ? JSON.parse(row.full_json) : null;
}

function getStats(pcapId, indexes = null) {
  const d = getDb();
  const totalRow = indexes
    ? { c: indexes.length }
    : d.prepare('SELECT COUNT(*) AS c FROM packets WHERE pcap_id = ?').get(pcapId);

  let rows;
  if (indexes) {
    if (!indexes.length) return { total: 0, byProtocol: {} };
    const placeholders = indexes.map(() => '?').join(',');
    rows = d.prepare(`
      SELECT protocol, COUNT(*) AS c FROM packets
      WHERE pcap_id = ? AND pkt_index IN (${placeholders})
      GROUP BY protocol
    `).all(pcapId, ...indexes);
  } else {
    rows = d.prepare(`
      SELECT protocol, COUNT(*) AS c FROM packets WHERE pcap_id = ?
      GROUP BY protocol
    `).all(pcapId);
  }
  const byProtocol = {};
  for (const r of rows) byProtocol[r.protocol || 'OTHER'] = r.c;
  return { total: totalRow.c, byProtocol };
}

function getTimelineRows(pcapId, indexes = null) {
  const d = getDb();
  if (indexes) {
    if (!indexes.length) return [];
    const placeholders = indexes.map(() => '?').join(',');
    return d.prepare(`
      SELECT ts, len FROM packets
      WHERE pcap_id = ? AND pkt_index IN (${placeholders})
      ORDER BY pkt_index
    `).all(pcapId, ...indexes);
  }
  return d.prepare(`
    SELECT ts, len FROM packets WHERE pcap_id = ? ORDER BY pkt_index
  `).all(pcapId);
}

function listOnvifRequests(pcapId) {
  return getDb().prepare(`
    SELECT pkt_index, http_pair_index, ts, src_ip, dst_ip, src_port, dst_port, onvif_action
    FROM packets
    WHERE pcap_id = ? AND is_onvif = 1 AND http_kind = 'request'
    ORDER BY pkt_index
  `).all(pcapId);
}

function getPcap(pcapId) {
  return getDb().prepare('SELECT * FROM pcaps WHERE id = ?').get(pcapId);
}

function deletePcap(pcapId) {
  const d = getDb();
  const txn = d.transaction(() => {
    d.prepare('DELETE FROM packet_blobs WHERE pcap_id = ?').run(pcapId);
    d.prepare('DELETE FROM packets WHERE pcap_id = ?').run(pcapId);
    d.prepare('DELETE FROM pcaps WHERE id = ?').run(pcapId);
  });
  txn();
}

function clearAll() {
  if (!db) return [];
  const ids = db.prepare('SELECT id, file_path FROM pcaps').all();
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM packet_blobs').run();
    db.prepare('DELETE FROM packets').run();
    db.prepare('DELETE FROM pcaps').run();
  });
  txn();
  return ids;
}

function close() {
  if (db) { db.close(); db = null; }
}

module.exports = {
  init, getDb, close,
  insertPcap, batchInsert,
  getPcap, listPackets, getPacketBlob,
  getStats, getTimelineRows, listOnvifRequests,
  deletePcap, clearAll,
};
