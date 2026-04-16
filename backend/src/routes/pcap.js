'use strict';
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { parsePcap, filterPackets, getStats, getTimeline } = require('../services/pcapParser');

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
// pcapId -> { filePath, packets }
const pcapStore = new Map();

function clearStore() {
  pcapStore.clear();
}

module.exports = async function pcapRoutes(fastify) {
  // Upload & parse pcap file
  fastify.post('/upload', async (req, reply) => {
    let fileBuffer, fileName;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        fileName = part.filename;
        fileBuffer = await part.toBuffer();
      }
    }
    if (!fileBuffer) return reply.code(400).send({ error: 'No file uploaded' });

    const pcapId = uuidv4();
    const filePath = path.join(uploadsDir, `${pcapId}.pcap`);
    fs.writeFileSync(filePath, fileBuffer);

    try {
      const packets = await parsePcap(filePath);
      pcapStore.set(pcapId, { filePath, packets });
      return { pcapId, total: packets.length };
    } catch (err) {
      fs.unlinkSync(filePath);
      return reply.code(422).send({ error: `Parse error: ${err.message}` });
    }
  });

  // Packet list with optional filter + pagination
  fastify.get('/:pcapId/packets', async (req, reply) => {
    const store = pcapStore.get(req.params.pcapId);
    if (!store) return reply.code(404).send({ error: 'Not found' });

    const { filter = '', page = '1', limit = '100' } = req.query;
    const filtered = filterPackets(store.packets, filter);
    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.min(500, Math.max(1, parseInt(limit)));
    const start = (pageNum - 1) * pageSize;
    const slice = filtered.slice(start, start + pageSize).map((p, i) => ({
      index: start + i,
      pktIndex: p.pktIndex ?? (start + i),
      ts: p.ts,
      protocol: p.protocol,
      srcIP: p.srcIP,
      dstIP: p.dstIP,
      srcPort: p.srcPort,
      dstPort: p.dstPort,
      len: p.len,
      summary: p.summary,
      httpPairIndex: p.httpPairIndex ?? null,
      httpKind: p.http?.kind ?? null,
      isOnvif: p.http?.isOnvif ?? false,
      onvifAction: p.http?.onvifAction ?? null,
      tcpContinuation: p.tcpContinuation ?? false,
      reassemblyHead: p.reassemblyHead ?? null,
      tcpAnomaly: p.tcpAnomaly ?? null,
    }));

    return { total: filtered.length, page: pageNum, pageSize, packets: slice };
  });

  // Packet detail (hex + ascii)
  fastify.get('/:pcapId/packet/:index', async (req, reply) => {
    const store = pcapStore.get(req.params.pcapId);
    if (!store) return reply.code(404).send({ error: 'Not found' });
    const idx = parseInt(req.params.index);
    const pkt = store.packets[idx];
    if (!pkt) return reply.code(404).send({ error: 'Packet not found' });
    return pkt;
  });

  // Protocol statistics
  fastify.get('/:pcapId/stats', async (req, reply) => {
    const store = pcapStore.get(req.params.pcapId);
    if (!store) return reply.code(404).send({ error: 'Not found' });
    const { filter = '' } = req.query;
    return getStats(filterPackets(store.packets, filter));
  });

  // Traffic timeline
  fastify.get('/:pcapId/timeline', async (req, reply) => {
    const store = pcapStore.get(req.params.pcapId);
    if (!store) return reply.code(404).send({ error: 'Not found' });
    const { filter = '', buckets = '60' } = req.query;
    return { timeline: getTimeline(filterPackets(store.packets, filter), parseInt(buckets)) };
  });

  // ONVIF interaction analysis
  fastify.get('/:pcapId/onvif', async (req, reply) => {
    const store = pcapStore.get(req.params.pcapId);
    if (!store) return reply.code(404).send({ error: 'Not found' });

    const packets = store.packets;
    const interactions = [];
    const seen = new Set();

    for (let i = 0; i < packets.length; i++) {
      const p = packets[i];
      if (!p.http?.isOnvif || p.http.kind !== 'request') continue;
      if (seen.has(i)) continue;
      seen.add(i);

      const respIdx = p.httpPairIndex ?? null;
      const resp = respIdx != null ? packets[respIdx] : null;
      if (respIdx != null) seen.add(respIdx);

      // Extract SOAP fault detail snippet if present
      let faultDetail = null;
      if (resp?.http?.hasSoapFault && resp.http.body) {
        const fm = resp.http.body.match(/<[^>]*[Ff]ault[\s\S]*?<\/[^>]*[Ff]ault>/);
        faultDetail = fm ? fm[0].slice(0, 800) : null;
      }

      const isError = resp?.http?.hasSoapFault ||
                      (resp?.http?.status != null && resp.http.status >= 400);

      interactions.push({
        reqIndex: i,
        respIndex: respIdx,
        ts: p.ts,
        src: `${p.srcIP}:${p.srcPort}`,
        dst: `${p.dstIP}:${p.dstPort}`,
        action: p.http.onvifAction ?? null,
        url: p.http.url ?? null,
        method: p.http.method ?? null,
        reqBody: p.http.body ?? null,
        status: resp?.http?.status ?? null,
        statusText: resp?.http?.statusText ?? null,
        hasSoapFault: resp?.http?.hasSoapFault ?? false,
        faultDetail,
        respBody: resp?.http?.body ?? null,
        isError,
        respTs: resp?.ts ?? null,
      });
    }

    return { interactions };
  });

  // Delete pcap from memory + disk
  fastify.delete('/:pcapId', async (req, reply) => {
    const store = pcapStore.get(req.params.pcapId);
    if (store) {
      try { fs.unlinkSync(store.filePath); } catch (_) {}
      pcapStore.delete(req.params.pcapId);
    }
    return { ok: true };
  });
};

module.exports.clearStore = clearStore;
