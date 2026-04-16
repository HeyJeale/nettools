'use strict';
const { PCAPNGParser } = require('@cto.af/pcap-ng-parser');
const { Readable } = require('stream');
const fs = require('fs');

function macToStr(buf) {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(':');
}

// ── HTTP parser ────────────────────────────────────────────────────────────────
function parseHttpPayload(ascii) {
  if (!ascii || ascii.length < 4) return null;
  const isRequest  = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE) /i.test(ascii);
  const isResponse = /^HTTP\/\d/i.test(ascii);
  if (!isRequest && !isResponse) return null;

  const headerEnd = ascii.indexOf('\r\n\r\n');
  const headerPart = headerEnd >= 0 ? ascii.slice(0, headerEnd) : ascii;
  const bodyRaw    = headerEnd >= 0 ? ascii.slice(headerEnd + 4) : '';

  const lines = headerPart.split('\r\n');
  const firstLine = lines[0];
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':');
    if (colon < 0) continue;
    const k = lines[i].slice(0, colon).trim().toLowerCase();
    const v = lines[i].slice(colon + 1).trim();
    headers[k] = v;
  }

  let body = bodyRaw;
  const ct = headers['content-type'] || '';
  if (ct.includes('json')) {
    try { body = JSON.stringify(JSON.parse(bodyRaw), null, 2); } catch (_) {}
  } else if (ct.includes('xml') || ct.includes('html')) {
    body = bodyRaw;
  }

  // ── ONVIF detection ──────────────────────────────────────────────────────────
  let isOnvif = false;
  let onvifAction = null;
  let hasSoapFault = false;

  const soapAction = (headers['soapaction'] || headers['soap-action'] || '').replace(/"/g, '').trim();

  if (isRequest) {
    const m2 = firstLine.match(/^(\S+)\s+(\S+)\s+(HTTP\/[\d.]+)/i);
    const urlPath = m2?.[2] || '';
    isOnvif = urlPath.toLowerCase().includes('/onvif/') ||
              soapAction.toLowerCase().includes('onvif.org');
    if (!isOnvif && body) isOnvif = body.toLowerCase().includes('onvif.org');
    if (isOnvif) {
      if (soapAction) {
        const parts = soapAction.split('/').filter(Boolean);
        onvifAction = parts[parts.length - 1] || soapAction;
      } else {
        const parts = urlPath.split('/').filter(Boolean);
        onvifAction = parts[parts.length - 1] || urlPath;
      }
    }
  } else {
    // Response: detect SOAP fault
    if (body) {
      hasSoapFault = /<[^>]*[Ff]ault[\s>]/.test(body);
      if (!isOnvif) isOnvif = body.toLowerCase().includes('onvif.org');
    }
  }

  if (isRequest) {
    const m = firstLine.match(/^(\S+)\s+(\S+)\s+(HTTP\/[\d.]+)/i);
    return { kind: 'request', method: m?.[1], url: m?.[2], version: m?.[3], headers, body, isOnvif, onvifAction };
  } else {
    const m = firstLine.match(/^(HTTP\/[\d.]+)\s+(\d+)\s+(.*)/i);
    return { kind: 'response', version: m?.[1], status: m?.[2] ? parseInt(m[2]) : null, statusText: m?.[3], headers, body, isOnvif, hasSoapFault };
  }
}

// ── Packet dissector ───────────────────────────────────────────────────────────
function dissect(ngPacket) {
  const data = Buffer.from(ngPacket.data);
  const ts = ngPacket.timestamp instanceof Date
    ? ngPacket.timestamp.getTime() / 1000
    : Number(ngPacket.timestamp) / 1e9;
  const pkt = {
    ts,
    len: ngPacket.originalPacketLength ?? data.length,
    capLen: data.length,
    rawHex: data.toString('hex'),
  };

  if (data.length < 14) { pkt.protocol = 'RAW'; pkt.summary = 'Raw'; return pkt; }

  // ── Ethernet ──
  const etherType = data.readUInt16BE(12);
  pkt.ethSrc = macToStr(data.slice(6, 12));
  pkt.ethDst = macToStr(data.slice(0, 6));
  pkt.etherType = `0x${etherType.toString(16).padStart(4, '0')}`;

  if (etherType === 0x0806) {
    pkt.protocol = 'ARP';
    if (data.length >= 42) {
      pkt.arpOp = data.readUInt16BE(20) === 1 ? 'request' : 'reply';
      pkt.arpSenderMac = macToStr(data.slice(22, 28));
      pkt.arpSenderIP  = `${data[28]}.${data[29]}.${data[30]}.${data[31]}`;
      pkt.arpTargetMac = macToStr(data.slice(32, 38));
      pkt.arpTargetIP  = `${data[38]}.${data[39]}.${data[40]}.${data[41]}`;
      pkt.summary = `ARP ${pkt.arpOp}: ${pkt.arpSenderIP} \u2192 ${pkt.arpTargetIP}`;
    } else {
      pkt.summary = 'ARP';
    }
    return pkt;
  }
  if (etherType === 0x86dd) { pkt.protocol = 'IPv6'; pkt.summary = 'IPv6'; return pkt; }
  if (etherType !== 0x0800) {
    pkt.protocol = `0x${etherType.toString(16)}`; pkt.summary = pkt.protocol; return pkt;
  }

  // ── IPv4 ──
  if (data.length < 34) { pkt.protocol = 'IPv4'; pkt.summary = 'IPv4 (truncated)'; return pkt; }
  const ihl = (data[14] & 0x0f) * 4;
  const ipProto = data[23];
  pkt.ipVersion  = (data[14] >> 4) & 0xf;
  pkt.ipIHL      = ihl;
  pkt.ipTOS      = data[15];
  pkt.ipTotalLen = data.readUInt16BE(16);
  pkt.ipId       = data.readUInt16BE(18);
  pkt.ipFlags    = (data[20] >> 5) & 0x7;
  pkt.ipFragOff  = ((data.readUInt16BE(20)) & 0x1fff) * 8;
  pkt.ttl        = data[22];
  pkt.ipProto    = ipProto;
  pkt.ipChecksum = `0x${data.readUInt16BE(24).toString(16).padStart(4, '0')}`;
  pkt.srcIP = `${data[26]}.${data[27]}.${data[28]}.${data[29]}`;
  pkt.dstIP = `${data[30]}.${data[31]}.${data[32]}.${data[33]}`;

  const ipPayload = data.slice(14 + ihl);

  // ── ICMP ──
  if (ipProto === 1) {
    pkt.protocol = 'ICMP';
    if (ipPayload.length >= 4) {
      pkt.icmpType = ipPayload[0];
      pkt.icmpCode = ipPayload[1];
      pkt.icmpChecksum = `0x${ipPayload.readUInt16BE(2).toString(16).padStart(4, '0')}`;
    }
    pkt.summary = `ICMP ${pkt.srcIP} \u2192 ${pkt.dstIP}`;
    return pkt;
  }

  // ── UDP ──
  if (ipProto === 17) {
    if (ipPayload.length < 8) { pkt.protocol = 'UDP'; pkt.summary = 'UDP'; return pkt; }
    pkt.srcPort      = ipPayload.readUInt16BE(0);
    pkt.dstPort      = ipPayload.readUInt16BE(2);
    pkt.udpLen       = ipPayload.readUInt16BE(4);
    pkt.udpChecksum  = `0x${ipPayload.readUInt16BE(6).toString(16).padStart(4, '0')}`;
    pkt.protocol     = (pkt.srcPort === 53 || pkt.dstPort === 53) ? 'DNS' : 'UDP';
    pkt.payload      = ipPayload.slice(8).toString('hex');
    pkt.payloadAscii = ipPayload.slice(8).toString('ascii').replace(/[^\x20-\x7e]/g, '.');
    pkt.summary = `${pkt.protocol} ${pkt.srcIP}:${pkt.srcPort} \u2192 ${pkt.dstIP}:${pkt.dstPort}`;
    return pkt;
  }

  // ── TCP ──
  if (ipProto === 6) {
    if (ipPayload.length < 20) { pkt.protocol = 'TCP'; pkt.summary = 'TCP'; return pkt; }
    pkt.srcPort     = ipPayload.readUInt16BE(0);
    pkt.dstPort     = ipPayload.readUInt16BE(2);
    pkt.tcpSeq      = ipPayload.readUInt32BE(4);
    pkt.tcpAck      = ipPayload.readUInt32BE(8);
    const tcpHdrLen = ((ipPayload[12] >> 4) & 0xf) * 4;
    pkt.tcpHdrLen   = tcpHdrLen;
    const flags     = ipPayload[13];
    pkt.tcpFlags    = {
      fin: !!(flags & 0x01), syn: !!(flags & 0x02), rst: !!(flags & 0x04),
      psh: !!(flags & 0x08), ack: !!(flags & 0x10), urg: !!(flags & 0x20),
    };
    pkt.tcpWindow   = ipPayload.readUInt16BE(14);
    pkt.tcpChecksum = `0x${ipPayload.readUInt16BE(16).toString(16).padStart(4, '0')}`;
    pkt.tcpUrgPtr   = ipPayload.readUInt16BE(18);

    const tcpPayload = ipPayload.slice(tcpHdrLen);
    pkt.payload      = tcpPayload.toString('hex');
    pkt.payloadAscii = tcpPayload.toString('ascii').replace(/[^\x20-\x7e]/g, '.');

    // Handshake/teardown/control packets (SYN, FIN, RST, or no payload) are
    // always TCP regardless of port. Only assign HTTP/HTTPS heuristic when
    // there is actual application data to inspect.
    const isControlPacket = pkt.tcpFlags.syn || pkt.tcpFlags.fin || pkt.tcpFlags.rst || tcpPayload.length === 0;
    if (!isControlPacket) {
      const isHttps = pkt.srcPort === 443 || pkt.dstPort === 443;
      const isHttp  = pkt.srcPort === 80 || pkt.dstPort === 80 ||
                      pkt.srcPort === 8080 || pkt.dstPort === 8080;
      pkt.protocol = isHttps ? 'HTTPS' : isHttp ? 'HTTP' : 'TCP';
    } else {
      pkt.protocol = 'TCP';
    }

    if (pkt.protocol === 'HTTP' && tcpPayload.length > 0) {
      // Use latin1 so \r\n is preserved for the HTTP header parser
      const http = parseHttpPayload(tcpPayload.toString('latin1'));
      if (http) pkt.http = http;
    }

    const flagStr = Object.entries(pkt.tcpFlags).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(',');
    if (pkt.http) {
      pkt.summary = pkt.http.kind === 'request'
        ? `HTTP ${pkt.http.method} ${pkt.http.url}`
        : `HTTP ${pkt.http.status} ${pkt.http.statusText || ''}`;
    } else {
      pkt.summary = `${pkt.protocol} ${pkt.srcIP}:${pkt.srcPort} \u2192 ${pkt.dstIP}:${pkt.dstPort} [${flagStr}]`;
    }
    return pkt;
  }

  pkt.protocol = `IP(${ipProto})`; pkt.summary = `IP proto ${ipProto}`;
  return pkt;
}

// ── HTTP request/response pairing ─────────────────────────────────────────────
function pairHttpPackets(packets) {
  const reqMap = new Map();

  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    if (p.protocol !== 'HTTP' || !p.http) continue;
    p.pktIndex = i;

    if (p.http.kind === 'request') {
      const key = `${p.srcIP}:${p.srcPort}\u2192${p.dstIP}:${p.dstPort}`;
      if (!reqMap.has(key)) reqMap.set(key, []);
      reqMap.get(key).push(i);
    } else if (p.http.kind === 'response') {
      const key = `${p.dstIP}:${p.dstPort}\u2192${p.srcIP}:${p.srcPort}`;
      const reqs = reqMap.get(key);
      if (reqs && reqs.length > 0) {
        const reqIdx = reqs.shift();
        p.httpPairIndex = reqIdx;
        packets[reqIdx].httpPairIndex = i;
        // Propagate ONVIF flag from request to response
        if (packets[reqIdx].http?.isOnvif && !p.http.isOnvif) {
          p.http.isOnvif = true;
        }
      }
    }
  }
}

// ── TCP stream reassembly ──────────────────────────────────────────────────────
function reassembleHttpStreams(packets) {
  const streams = new Map();

  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    if (!['TCP', 'HTTP', 'HTTPS'].includes(p.protocol)) continue;
    if (!p.srcPort || !p.payload) continue;

    const payload = Buffer.from(p.payload, 'hex');
    if (!payload.length) {
      if ((p.protocol === 'HTTP' || p.protocol === 'HTTPS') && !p.http) {
        const flagStr = Object.entries(p.tcpFlags || {}).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(',');
        p.protocol = 'TCP';
        p.summary = `TCP ${p.srcIP}:${p.srcPort} \u2192 ${p.dstIP}:${p.dstPort} [${flagStr}]`;
      }
      continue;
    }

    const dirKey = `${p.srcIP}:${p.srcPort}->${p.dstIP}:${p.dstPort}`;
    const ascii = payload.toString('latin1');

    if (!streams.has(dirKey)) {
      const isHttpStart = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE) /i.test(ascii)
                       || /^HTTP\/\d/i.test(ascii);

      if (!isHttpStart) {
        if ((p.protocol === 'HTTP' || p.protocol === 'HTTPS') && !p.http) {
          const flagStr = Object.entries(p.tcpFlags || {}).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(',');
          p.protocol = 'TCP';
          p.summary = `TCP ${p.srcIP}:${p.srcPort} \u2192 ${p.dstIP}:${p.dstPort} [${flagStr}]`;
        }
        continue;
      }

      streams.set(dirKey, { segs: [i], buf: ascii });
      p.http = undefined;
      p.protocol = 'TCP';
      p.tcpContinuation = true;
      const flagStr = Object.entries(p.tcpFlags || {}).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(',');
      p.summary = `TCP ${p.srcIP}:${p.srcPort} \u2192 ${p.dstIP}:${p.dstPort} [${flagStr}] [HTTP data]`;

      const http = parseHttpPayload(ascii);
      if (http && isHttpComplete(http, ascii)) {
        promoteToHttp(p, http, [i], packets);
        streams.delete(dirKey);
      }
    } else {
      const stream = streams.get(dirKey);
      stream.buf += ascii;
      stream.segs.push(i);

      p.protocol = 'TCP';
      p.tcpContinuation = true;
      p.http = undefined;
      const flagStr = Object.entries(p.tcpFlags || {}).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(',');
      p.summary = `TCP ${p.srcIP}:${p.srcPort} \u2192 ${p.dstIP}:${p.dstPort} [${flagStr}] [HTTP data]`;

      const http = parseHttpPayload(stream.buf);
      if (http && isHttpComplete(http, stream.buf)) {
        promoteToHttp(p, http, stream.segs, packets);
        streams.delete(dirKey);
      }
    }
  }
}

function isHttpComplete(http, buf) {
  const cl = parseInt(http.headers?.['content-length'] || '-1');
  if (cl < 0) return true;
  const headerEnd = buf.indexOf('\r\n\r\n');
  const bodyLen = headerEnd >= 0 ? buf.length - (headerEnd + 4) : 0;
  return bodyLen >= cl;
}

function promoteToHttp(p, http, segs, packets) {
  const completingIndex = p.pktIndex;

  p.protocol = 'HTTP';
  p.http = http;
  p.tcpContinuation = false;
  p.reassemblyHead = null;
  p.summary = http.kind === 'request'
    ? `HTTP ${http.method} ${http.url}`
    : `HTTP ${http.status} ${http.statusText || ''}`;

  if (segs.length > 1) {
    p.reassembledSegments = segs.map((idx) => ({
      pktIndex: idx,
      len: packets[idx].payload ? packets[idx].payload.length / 2 : 0,
    }));
    p.reassembledTotalBytes = p.reassembledSegments.reduce((s, seg) => s + seg.len, 0);
  }

  for (let s = 0; s < segs.length - 1; s++) {
    const pred = packets[segs[s]];
    pred.tcpContinuation = true;
    pred.reassemblyHead = completingIndex;
    pred.protocol = 'TCP';
    const flagStr = Object.entries(pred.tcpFlags || {}).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(',');
    pred.summary = `TCP ${pred.srcIP}:${pred.srcPort} \u2192 ${pred.dstIP}:${pred.dstPort} [${flagStr}] [HTTP data]`;
  }
}

// ── TCP anomaly detection ──────────────────────────────────────────────────────
function detectTcpAnomalies(packets) {
  const seqState = new Map();
  const ackState = new Map();

  for (const p of packets) {
    if (!['TCP', 'HTTP', 'HTTPS'].includes(p.protocol)) continue;
    if (p.tcpSeq == null) continue;

    const flags = p.tcpFlags || {};
    const seq     = p.tcpSeq;
    const ack     = p.tcpAck;
    const dataLen = p.payload ? p.payload.length / 2 : 0;
    const dirKey  = `${p.srcIP}:${p.srcPort}->${p.dstIP}:${p.dstPort}`;

    if (flags.ack && !flags.syn && !flags.rst && p.tcpWindow === 0 && dataLen === 0) {
      p.tcpAnomaly = 'Zero Window';
    }

    if (flags.syn && !flags.ack) {
      seqState.set(dirKey, { nextSeq: seq + 1, seenSeqs: new Map() });
      ackState.set(dirKey, { lastAck: null, count: 0 });
      continue;
    }
    if (flags.rst) continue;

    if (!seqState.has(dirKey)) {
      seqState.set(dirKey, { nextSeq: seq + dataLen || seq + 1, seenSeqs: new Map([[seq, dataLen]]) });
      ackState.set(dirKey, { lastAck: ack, count: 0 });
      continue;
    }

    const state = seqState.get(dirKey);

    if (dataLen > 0) {
      if (state.seenSeqs.has(seq)) {
        if (!p.tcpAnomaly) p.tcpAnomaly = 'Retransmission';
      } else if (seq < state.nextSeq) {
        if (!p.tcpAnomaly) p.tcpAnomaly = 'Retransmission';
      } else if (seq > state.nextSeq) {
        if (!p.tcpAnomaly) p.tcpAnomaly = 'Out-of-Order';
      }

      state.seenSeqs.set(seq, dataLen);
      if (seq + dataLen > state.nextSeq) {
        state.nextSeq = seq + dataLen;
      }
    }

    if (flags.ack && !flags.syn && !flags.fin && dataLen === 0 && p.tcpWindow !== 0) {
      const as = ackState.get(dirKey) || { lastAck: null, count: 0 };
      if (as.lastAck !== null && ack === as.lastAck) {
        as.count++;
        if (as.count >= 2) {
          if (!p.tcpAnomaly) p.tcpAnomaly = 'Dup ACK';
        }
      } else {
        as.lastAck = ack;
        as.count = 0;
      }
      ackState.set(dirKey, as);
    } else if (flags.ack && dataLen === 0 && !flags.syn && !flags.fin) {
      const as = ackState.get(dirKey) || { lastAck: null, count: 0 };
      as.lastAck = ack; as.count = 0;
      ackState.set(dirKey, as);
    }
  }
}

function parsePcap(filePath) {
  return new Promise((resolve, reject) => {
    const packets = [];
    const parser = new PCAPNGParser();
    parser.on('data', (pkt) => packets.push(dissect(pkt)));
    parser.on('error', reject);
    Readable.toWeb(fs.createReadStream(filePath))
      .pipeTo(parser)
      .then(() => {
        packets.forEach((p, i) => { p.pktIndex = i; });
        reassembleHttpStreams(packets);
        detectTcpAnomalies(packets);
        pairHttpPackets(packets);
        resolve(packets);
      })
      .catch(reject);
  });
}

// ── Filter engine ──────────────────────────────────────────────────────────────
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }
    if (expr.slice(i, i + 2) === '&&') { tokens.push({ t: 'AND' }); i += 2; continue; }
    if (expr.slice(i, i + 2) === '||') { tokens.push({ t: 'OR' }); i += 2; continue; }
    if (expr[i] === '!') { tokens.push({ t: 'NOT' }); i++; continue; }
    if (expr[i] === '(') { tokens.push({ t: 'LPAREN' }); i++; continue; }
    if (expr[i] === ')') { tokens.push({ t: 'RPAREN' }); i++; continue; }
    if (expr[i] === '"' || expr[i] === "'") {
      const q = expr[i++]; let s = '';
      while (i < expr.length && expr[i] !== q) s += expr[i++];
      i++;
      tokens.push({ t: 'STR', v: s }); continue;
    }
    let word = '';
    while (i < expr.length && !/[\s()!]/.test(expr[i]) && expr.slice(i, i + 2) !== '&&' && expr.slice(i, i + 2) !== '||') {
      word += expr[i++];
    }
    if (word) tokens.push({ t: 'WORD', v: word });
  }
  return tokens;
}

function buildAst(tokens) {
  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }
  function parseExpr() {
    let left = parseTerm();
    while (peek() && (peek().t === 'AND' || peek().t === 'OR')) {
      const op = consume().t;
      const right = parseTerm();
      left = { op, left, right };
    }
    return left;
  }
  function parseTerm() {
    if (peek()?.t === 'NOT') { consume(); return { op: 'NOT', child: parseTerm() }; }
    if (peek()?.t === 'LPAREN') {
      consume();
      const node = parseExpr();
      if (peek()?.t === 'RPAREN') consume();
      return node;
    }
    return parseAtom();
  }
  function parseAtom() {
    const tok = consume();
    if (!tok) return { op: 'BOOL', v: true };
    const word = tok.v?.toLowerCase() || '';
    if (word === 'contains') {
      const strTok = consume();
      return { op: 'CONTAINS', v: strTok?.v || '' };
    }
    const eqMatch = word.match(/^(ip\.src|ip\.dst|tcp\.port|udp\.port|port)(==|!=|=)(.+)$/);
    if (eqMatch) {
      const [, field, op, val] = eqMatch;
      return { op: 'CMP', field, cmp: op === '!=' ? '!=' : '==', val };
    }
    return { op: 'PROTO', v: word };
  }
  return parseExpr();
}

function evalAst(node, pkt) {
  if (!node) return true;
  switch (node.op) {
    case 'AND': return evalAst(node.left, pkt) && evalAst(node.right, pkt);
    case 'OR':  return evalAst(node.left, pkt) || evalAst(node.right, pkt);
    case 'NOT': return !evalAst(node.child, pkt);
    case 'BOOL': return node.v;
    case 'PROTO': return pkt.protocol?.toLowerCase() === node.v;
    case 'CONTAINS': {
      const needle = node.v.toLowerCase();
      return (pkt.payloadAscii || '').toLowerCase().includes(needle) ||
             (pkt.rawHex || '').includes(Buffer.from(node.v).toString('hex'));
    }
    case 'CMP': {
      const { field, cmp, val } = node;
      let actual;
      if (field === 'ip.src') actual = pkt.srcIP;
      else if (field === 'ip.dst') actual = pkt.dstIP;
      else if (field === 'port') actual = String(pkt.srcPort) === val || String(pkt.dstPort) === val ? val : null;
      else if (field === 'tcp.port') actual = pkt.protocol?.startsWith('TCP') || pkt.protocol === 'HTTP' || pkt.protocol === 'HTTPS'
        ? (String(pkt.srcPort) === val || String(pkt.dstPort) === val ? val : null) : null;
      else if (field === 'udp.port') actual = pkt.protocol === 'UDP' || pkt.protocol === 'DNS'
        ? (String(pkt.srcPort) === val || String(pkt.dstPort) === val ? val : null) : null;
      if (field === 'port' || field === 'tcp.port' || field === 'udp.port') {
        return cmp === '!=' ? actual === null : actual !== null;
      }
      return cmp === '!=' ? actual !== val : actual === val;
    }
    default: return true;
  }
}

function filterPackets(packets, filterExpr) {
  if (!filterExpr || !filterExpr.trim()) return packets;
  try {
    const ast = buildAst(tokenize(filterExpr));
    return packets.filter((p) => evalAst(ast, p));
  } catch (_) {
    return packets;
  }
}

function getStats(packets) {
  const proto = {};
  for (const p of packets) {
    const k = p.protocol || 'OTHER';
    proto[k] = (proto[k] || 0) + 1;
  }
  return { total: packets.length, byProtocol: proto };
}

function getTimeline(packets, buckets = 60) {
  if (!packets.length) return [];
  const minTs = packets[0].ts;
  const maxTs = packets[packets.length - 1].ts;
  const span = maxTs - minTs || 1;
  const bucketSize = span / buckets;
  const data = Array.from({ length: buckets }, (_, i) => ({
    t: minTs + i * bucketSize,
    bytes: 0,
    count: 0,
  }));
  for (const p of packets) {
    const idx = Math.max(0, Math.min(Math.floor((p.ts - minTs) / bucketSize), buckets - 1));
    data[idx].bytes += p.len;
    data[idx].count += 1;
  }
  return data;
}

module.exports = { parsePcap, filterPackets, getStats, getTimeline };
