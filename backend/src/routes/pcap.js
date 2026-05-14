'use strict';
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { parsePcap, filterFrames } = require('../services/pcapParser');
const { getFrameHex } = require('../services/tsharkAdapter');
const pcapDb = require('../services/pcapDb');

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

function dbRowToListItem(row) {
  return {
    pktIndex: row.pkt_index,
    ts: row.ts,
    protocol: row.protocol,
    srcIP: row.src_ip,
    dstIP: row.dst_ip,
    srcPort: row.src_port,
    dstPort: row.dst_port,
    len: row.len,
    summary: row.summary,
    httpPairIndex: row.http_pair_index,
    httpKind: row.http_kind,
    isOnvif: row.is_onvif === 1,
    onvifAction: row.onvif_action,
    tcpContinuation: row.tcp_continuation === 1,
    reassemblyHead: row.reassembly_head,
    tcpAnomaly: row.tcp_anomaly,
  };
}

async function resolveFilter(filePath, filter) {
  const expr = (filter || '').trim();
  if (!expr) return null;
  return filterFrames(filePath, expr);
}

function clearStore() {
  return pcapDb.clearAll();
}

module.exports = async function pcapRoutes(fastify) {
  // Upload & parse pcap file
  fastify.post('/upload', async (req, reply) => {
    let fileBuffer;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
      }
    }
    if (!fileBuffer) return reply.code(400).send({ error: 'No file uploaded' });

    const pcapId = uuidv4();
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, `${pcapId}.pcap`);
    fs.writeFileSync(filePath, fileBuffer);

    try {
      const { total } = await parsePcap(filePath, pcapId);
      return { pcapId, total };
    } catch (err) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      try { pcapDb.deletePcap(pcapId); } catch (_) {}
      return reply.code(422).send({ error: `Parse error: ${err.message}` });
    }
  });

  // Packet list with optional filter + pagination
  fastify.get('/:pcapId/packets', async (req, reply) => {
    const pcap = pcapDb.getPcap(req.params.pcapId);
    if (!pcap) return reply.code(404).send({ error: 'Not found' });

    const { filter = '', page = '1', limit = '100' } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.min(500, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * pageSize;

    let indexes = null;
    try {
      indexes = await resolveFilter(pcap.file_path, filter);
    } catch (err) {
      return reply.code(400).send({ error: `Filter error: ${err.message}` });
    }

    const { total, rows } = pcapDb.listPackets(req.params.pcapId, { limit: pageSize, offset, indexes });
    const packets = rows.map((r, i) => ({ index: offset + i, ...dbRowToListItem(r) }));
    return { total, page: pageNum, pageSize, packets };
  });

  // Packet detail
  fastify.get('/:pcapId/packet/:index', async (req, reply) => {
    const pcap = pcapDb.getPcap(req.params.pcapId);
    if (!pcap) return reply.code(404).send({ error: 'Not found' });
    const idx = parseInt(req.params.index);
    const pkt = pcapDb.getPacketBlob(req.params.pcapId, idx);
    if (!pkt) return reply.code(404).send({ error: 'Packet not found' });
    return pkt;
  });

  // Protocol statistics
  fastify.get('/:pcapId/stats', async (req, reply) => {
    const pcap = pcapDb.getPcap(req.params.pcapId);
    if (!pcap) return reply.code(404).send({ error: 'Not found' });
    const { filter = '' } = req.query;
    let indexes = null;
    try {
      indexes = await resolveFilter(pcap.file_path, filter);
    } catch (err) {
      return reply.code(400).send({ error: `Filter error: ${err.message}` });
    }
    return pcapDb.getStats(req.params.pcapId, indexes);
  });

  // Traffic timeline
  fastify.get('/:pcapId/timeline', async (req, reply) => {
    const pcap = pcapDb.getPcap(req.params.pcapId);
    if (!pcap) return reply.code(404).send({ error: 'Not found' });
    const { filter = '', buckets = '60' } = req.query;
    let indexes = null;
    try {
      indexes = await resolveFilter(pcap.file_path, filter);
    } catch (err) {
      return reply.code(400).send({ error: `Filter error: ${err.message}` });
    }
    const rows = pcapDb.getTimelineRows(req.params.pcapId, indexes);
    return { timeline: bucketize(rows, parseInt(buckets) || 60) };
  });

  // ONVIF interaction analysis
  fastify.get('/:pcapId/onvif', async (req, reply) => {
    const pcap = pcapDb.getPcap(req.params.pcapId);
    if (!pcap) return reply.code(404).send({ error: 'Not found' });

    const requests = pcapDb.listOnvifRequests(req.params.pcapId);
    const interactions = [];

    for (const r of requests) {
      const reqPkt = pcapDb.getPacketBlob(req.params.pcapId, r.pkt_index);
      if (!reqPkt) continue;
      const respIdx = r.http_pair_index;
      const respPkt = respIdx != null ? pcapDb.getPacketBlob(req.params.pcapId, respIdx) : null;

      let faultDetail = null;
      if (respPkt?.http?.hasSoapFault && respPkt.http.body) {
        const fm = respPkt.http.body.match(/<[^>]*[Ff]ault[\s\S]*?<\/[^>]*[Ff]ault>/);
        faultDetail = fm ? fm[0].slice(0, 800) : null;
      }
      const isError = respPkt?.http?.hasSoapFault ||
                      (respPkt?.http?.status != null && respPkt.http.status >= 400);

      interactions.push({
        reqIndex: r.pkt_index,
        respIndex: respIdx,
        ts: r.ts,
        src: `${r.src_ip}:${r.src_port}`,
        dst: `${r.dst_ip}:${r.dst_port}`,
        action: r.onvif_action,
        url: reqPkt.http?.url ?? null,
        method: reqPkt.http?.method ?? null,
        reqBody: reqPkt.http?.body ?? null,
        status: respPkt?.http?.status ?? null,
        statusText: respPkt?.http?.statusText ?? null,
        hasSoapFault: respPkt?.http?.hasSoapFault ?? false,
        faultDetail,
        respBody: respPkt?.http?.body ?? null,
        isError,
        respTs: respPkt?.ts ?? null,
      });
    }
    return { interactions };
  });

  // Delete pcap from memory + disk
  fastify.delete('/:pcapId', async (req, reply) => {
    const pcap = pcapDb.getPcap(req.params.pcapId);
    if (pcap) {
      try { fs.unlinkSync(pcap.file_path); } catch (_) {}
      pcapDb.deletePcap(req.params.pcapId);
    }
    return { ok: true };
  });
};

function bucketize(rows, buckets) {
  if (!rows.length) return [];
  const minTs = rows[0].ts;
  const maxTs = rows[rows.length - 1].ts;
  const span = maxTs - minTs || 1;
  const bucketSize = span / buckets;
  const data = Array.from({ length: buckets }, (_, i) => ({
    t: minTs + i * bucketSize, bytes: 0, count: 0,
  }));
  for (const r of rows) {
    const idx = Math.max(0, Math.min(Math.floor((r.ts - minTs) / bucketSize), buckets - 1));
    data[idx].bytes += r.len;
    data[idx].count += 1;
  }
  return data;
}

module.exports.clearStore = clearStore;
