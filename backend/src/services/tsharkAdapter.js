'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const split2 = require('split2');
const { resolveTsharkPath } = require('./tsharkBin');

const MAX_RAW_HEX_BYTES   = 256;
const MAX_PAYLOAD_STORE   = 4096;
const MAX_HTTP_BODY_BYTES = 65536;

// Field list for the streaming list pass. Order matters: matches FIELDS array.
const FIELDS = [
  'frame.number', 'frame.time_epoch', 'frame.len', 'frame.cap_len', 'frame.protocols',
  'eth.src', 'eth.dst', 'eth.type',
  'sll.src.eth', 'sll.etype',
  'ip.version', 'ip.hdr_len', 'ip.dsfield', 'ip.len', 'ip.id', 'ip.flags',
  'ip.frag_offset', 'ip.ttl', 'ip.proto', 'ip.checksum', 'ip.src', 'ip.dst',
  'arp.opcode', 'arp.src.hw_mac', 'arp.src.proto_ipv4', 'arp.dst.hw_mac', 'arp.dst.proto_ipv4',
  'icmp.type', 'icmp.code', 'icmp.checksum',
  'udp.srcport', 'udp.dstport', 'udp.length', 'udp.checksum', 'udp.payload',
  'tcp.srcport', 'tcp.dstport', 'tcp.seq_raw', 'tcp.ack_raw', 'tcp.hdr_len',
  'tcp.flags.fin', 'tcp.flags.syn', 'tcp.flags.reset', 'tcp.flags.push', 'tcp.flags.ack', 'tcp.flags.urg',
  'tcp.window_size', 'tcp.checksum', 'tcp.urgent_pointer', 'tcp.payload',
  'tcp.analysis.retransmission', 'tcp.analysis.out_of_order',
  'tcp.analysis.duplicate_ack', 'tcp.analysis.zero_window',
  'tcp.reassembled_in', 'tcp.reassembled.length', 'tcp.segment',
  'http.request.method', 'http.request.uri', 'http.request.version',
  'http.response.code', 'http.response.phrase', 'http.response.version',
  'http.request.line', 'http.response.line',
  'http.request_in', 'http.response_in',
  'http.host', 'http.user_agent', 'http.content_type', 'http.content_length',
  'http.file_data',
  '_ws.col.Info',
];

const HTTP_METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)$/i;

function parseFieldLine(line) {
  // tshark -T fields -E separator=\t -E occurrence=f produces tab-separated fields, in same order
  return line.split('\t');
}

function asNum(s) { if (s == null || s === '') return null; const n = Number(s); return Number.isNaN(n) ? null : n; }
function asInt(s) { if (s == null || s === '') return null; const n = parseInt(s, 10); return Number.isNaN(n) ? null : n; }
function asBool(s) { return s === '1' || s === 'true' || s === 'TRUE' || s === 'True'; }
function asPresent(s) { return s != null && s !== ''; }

// Convert tshark hex byte string ("01:02:ff" or "0102ff") to hex
function bytesToHex(s) {
  if (!s) return '';
  return s.replace(/[\s:]/g, '');
}

function deriveProtocol(protocols, srcPort, dstPort) {
  const p = (protocols || '').toLowerCase();
  if (p.includes(':http:')) return 'HTTP';
  if (p.endsWith(':http')) return 'HTTP';
  if (p.includes(':tls') || p.includes(':ssl')) return 'HTTPS';
  if (p.includes(':rtsp')) return 'RTSP';
  if (p.includes(':rtcp')) return 'RTCP';
  if (p.includes(':rtp') || p.includes(':rdt')) return 'RTP';
  if (p.includes(':dns') || p.includes(':mdns') || p.includes(':llmnr')) return 'DNS';
  if (p.includes(':ssdp')) return 'SSDP';
  if (p.includes(':igmp')) return 'IGMP';
  if (p.includes(':icmp')) return 'ICMP';
  if (p.includes(':arp')) return 'ARP';
  if (p.includes(':lldp')) return 'LLDP';
  if (p.includes(':stp')) return 'STP';
  // Heuristic: data above TCP/UDP is opaque payload, classify as the L4 protocol
  if (p.includes(':tcp')) {
    if (srcPort === 443 || dstPort === 443) return 'HTTPS';
    if (srcPort === 80 || dstPort === 80 || srcPort === 8080 || dstPort === 8080) return 'HTTP';
    return 'TCP';
  }
  if (p.includes(':udp')) return 'UDP';
  if (p.includes(':ipv6')) return 'IPv6';
  if (p.includes(':ip')) return 'IPv4';
  const parts = p.split(':').filter(Boolean);
  return (parts[parts.length - 1] || 'OTHER').toUpperCase();
}

function detectTcpAnomaly(retr, ooo, dup, zw) {
  if (asPresent(retr)) return 'Retransmission';
  if (asPresent(ooo))  return 'Out-of-Order';
  if (asPresent(dup))  return 'Dup ACK';
  if (asPresent(zw))   return 'Zero Window';
  return null;
}

function reconstructHttp(fields, payloadAscii) {
  const reqMethod = fields['http.request.method'];
  const respCode  = fields['http.response.code'];
  const isReq = reqMethod && HTTP_METHODS.test(reqMethod);
  const isResp = !!respCode;
  if (!isReq && !isResp) return null;

  const headers = {};
  // Prefer tshark's parsed header lines (works even when payload is reassembled across segments).
  // Multi-value aggregator is ASCII unit separator (0x1f) to avoid colliding with values that contain commas.
  const headerLines = isReq ? fields['http.request.line'] : fields['http.response.line'];
  if (headerLines) {
    for (const raw of headerLines.split('\x1f')) {
      const line = raw.replace(/\\r\\n$|\r\n$/, '').trim();
      if (!line) continue;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const k = line.slice(0, colon).trim().toLowerCase();
      const v = line.slice(colon + 1).trim().replace(/\\r\\n$|\r\n$/, '');
      if (k) headers[k] = v;
    }
  } else if (payloadAscii) {
    // Fall back to parsing from payload (single-segment HTTP messages)
    const headerEnd = payloadAscii.indexOf('\r\n\r\n');
    const headerPart = headerEnd >= 0 ? payloadAscii.slice(0, headerEnd) : payloadAscii;
    const lines = headerPart.split('\r\n');
    for (let i = 1; i < lines.length; i++) {
      const colon = lines[i].indexOf(':');
      if (colon < 0) continue;
      const k = lines[i].slice(0, colon).trim().toLowerCase();
      const v = lines[i].slice(colon + 1).trim();
      if (k) headers[k] = v;
    }
  }

  // file_data is tshark's dechunked/decompressed body; prefer it over payloadAscii body
  let body = fields['http.file_data'] || '';
  if (!body && payloadAscii) {
    const headerEnd = payloadAscii.indexOf('\r\n\r\n');
    if (headerEnd >= 0) body = payloadAscii.slice(headerEnd + 4);
  }
  // tshark FT_BYTES fields come back as hex (continuous "61626263" or colon-separated "61:62:63").
  // Decode to latin1 if the entire string looks like hex.
  if (body) {
    const stripped = body.replace(/[\s:]/g, '');
    if (stripped.length >= 2 && stripped.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(stripped)) {
      try { body = Buffer.from(stripped, 'hex').toString('latin1'); } catch (_) {}
    }
  }
  const bodyTruncated = body.length > MAX_HTTP_BODY_BYTES;
  if (bodyTruncated) body = body.slice(0, MAX_HTTP_BODY_BYTES) + '\n[truncated]';

  const ct = (fields['http.content_type'] || headers['content-type'] || '').toLowerCase();
  if (ct.includes('json')) {
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch (_) {}
  }

  // ONVIF heuristic (preserved from legacy implementation)
  let isOnvif = false;
  let onvifAction = null;
  let hasSoapFault = false;
  const soapAction = (headers['soapaction'] || headers['soap-action'] || '').replace(/"/g, '').trim();

  if (isReq) {
    const url = fields['http.request.uri'] || '';
    isOnvif = url.toLowerCase().includes('/onvif/') || soapAction.toLowerCase().includes('onvif.org');
    if (!isOnvif && body) isOnvif = body.toLowerCase().includes('onvif.org');
    if (isOnvif) {
      if (soapAction) {
        const parts = soapAction.split('/').filter(Boolean);
        onvifAction = parts[parts.length - 1] || soapAction;
      } else {
        const parts = url.split('/').filter(Boolean);
        onvifAction = parts[parts.length - 1] || url;
      }
    }
  } else if (body) {
    hasSoapFault = /<[^>]*[Ff]ault[\s>]/.test(body);
    if (!isOnvif) isOnvif = body.toLowerCase().includes('onvif.org');
  }

  if (isReq) {
    return {
      kind: 'request',
      method: reqMethod,
      url: fields['http.request.uri'] || '',
      version: fields['http.request.version'] || '',
      headers, body, bodyTruncated,
      isOnvif, onvifAction,
    };
  }
  return {
    kind: 'response',
    version: fields['http.response.version'] || '',
    status: asInt(respCode),
    statusText: fields['http.response.phrase'] || '',
    headers, body, bodyTruncated,
    isOnvif, hasSoapFault,
  };
}

function buildPacket(rowFields, fieldsByName, frameRawHex, payloadHex) {
  const frameNum = asInt(fieldsByName['frame.number']);
  const pktIndex = (frameNum != null) ? frameNum - 1 : null;
  const len = asInt(fieldsByName['frame.len']) ?? 0;
  const capLen = asInt(fieldsByName['frame.cap_len']) ?? len;
  const ts = asNum(fieldsByName['frame.time_epoch']) ?? 0;

  const srcPort = asInt(fieldsByName['tcp.srcport']) ?? asInt(fieldsByName['udp.srcport']);
  const dstPort = asInt(fieldsByName['tcp.dstport']) ?? asInt(fieldsByName['udp.dstport']);
  let protocol = deriveProtocol(fieldsByName['frame.protocols'], srcPort, dstPort);

  // TCP segments awaiting reassembly are TCP, not the upper-layer protocol
  const reasmIn = asInt(fieldsByName['tcp.reassembled_in']);
  const hasHttpReq = asPresent(fieldsByName['http.request.method']);
  const hasHttpResp = asPresent(fieldsByName['http.response.code']);
  if (reasmIn != null && protocol === 'HTTP' && !hasHttpReq && !hasHttpResp) {
    protocol = 'TCP';
  }

  const pkt = {
    pktIndex, ts, len, capLen,
    rawHex: (frameRawHex || '').slice(0, MAX_RAW_HEX_BYTES * 2),
    rawLen: capLen,
    protocol,
  };

  // Ethernet / SLL
  const ethSrc = fieldsByName['eth.src'] || fieldsByName['sll.src.eth'];
  const ethDst = fieldsByName['eth.dst'];
  const etherType = fieldsByName['eth.type'] || fieldsByName['sll.etype'];
  if (ethSrc) pkt.ethSrc = ethSrc;
  if (ethDst) pkt.ethDst = ethDst;
  if (etherType) {
    const n = parseInt(etherType, etherType.startsWith('0x') ? 16 : 10);
    if (!Number.isNaN(n)) pkt.etherType = `0x${n.toString(16).padStart(4, '0')}`;
  }

  // ARP
  if (asPresent(fieldsByName['arp.opcode'])) {
    pkt.arpOp = asInt(fieldsByName['arp.opcode']) === 1 ? 'request' : 'reply';
    pkt.arpSenderMac = fieldsByName['arp.src.hw_mac'] || null;
    pkt.arpSenderIP  = fieldsByName['arp.src.proto_ipv4'] || null;
    pkt.arpTargetMac = fieldsByName['arp.dst.hw_mac'] || null;
    pkt.arpTargetIP  = fieldsByName['arp.dst.proto_ipv4'] || null;
  }

  // IPv4
  if (asPresent(fieldsByName['ip.src'])) {
    pkt.ipVersion  = asInt(fieldsByName['ip.version']);
    pkt.ipIHL      = asInt(fieldsByName['ip.hdr_len']);
    pkt.ipTOS      = asInt(fieldsByName['ip.dsfield']);
    pkt.ipTotalLen = asInt(fieldsByName['ip.len']);
    pkt.ipId       = asInt(fieldsByName['ip.id']);
    pkt.ipFlags    = asInt(fieldsByName['ip.flags']);
    pkt.ipFragOff  = asInt(fieldsByName['ip.frag_offset']);
    pkt.ttl        = asInt(fieldsByName['ip.ttl']);
    pkt.ipProto    = asInt(fieldsByName['ip.proto']);
    if (fieldsByName['ip.checksum']) {
      const cn = parseInt(fieldsByName['ip.checksum'], fieldsByName['ip.checksum'].startsWith('0x') ? 16 : 10);
      if (!Number.isNaN(cn)) pkt.ipChecksum = `0x${cn.toString(16).padStart(4, '0')}`;
    }
    pkt.srcIP = fieldsByName['ip.src'];
    pkt.dstIP = fieldsByName['ip.dst'];
  }

  // ICMP
  if (asPresent(fieldsByName['icmp.type'])) {
    pkt.icmpType     = asInt(fieldsByName['icmp.type']);
    pkt.icmpCode     = asInt(fieldsByName['icmp.code']);
    if (fieldsByName['icmp.checksum']) {
      const cn = parseInt(fieldsByName['icmp.checksum'], 10);
      if (!Number.isNaN(cn)) pkt.icmpChecksum = `0x${cn.toString(16).padStart(4, '0')}`;
    }
  }

  // UDP
  if (asPresent(fieldsByName['udp.srcport'])) {
    pkt.srcPort     = asInt(fieldsByName['udp.srcport']);
    pkt.dstPort     = asInt(fieldsByName['udp.dstport']);
    pkt.udpLen      = asInt(fieldsByName['udp.length']);
    if (fieldsByName['udp.checksum']) {
      const cn = parseInt(fieldsByName['udp.checksum'], 10);
      if (!Number.isNaN(cn)) pkt.udpChecksum = `0x${cn.toString(16).padStart(4, '0')}`;
    }
    const udpHex = bytesToHex(fieldsByName['udp.payload'] || '');
    if (udpHex) {
      pkt.payload = udpHex;
      const buf = Buffer.from(udpHex, 'hex');
      pkt.payloadAscii = buf.slice(0, MAX_PAYLOAD_STORE).toString('ascii').replace(/[^\x20-\x7e]/g, '.');
    }
  }

  // TCP
  if (asPresent(fieldsByName['tcp.srcport'])) {
    pkt.srcPort     = asInt(fieldsByName['tcp.srcport']);
    pkt.dstPort     = asInt(fieldsByName['tcp.dstport']);
    pkt.tcpSeq      = asInt(fieldsByName['tcp.seq_raw']);
    pkt.tcpAck      = asInt(fieldsByName['tcp.ack_raw']);
    pkt.tcpHdrLen   = asInt(fieldsByName['tcp.hdr_len']);
    pkt.tcpFlags    = {
      fin: asBool(fieldsByName['tcp.flags.fin']),
      syn: asBool(fieldsByName['tcp.flags.syn']),
      rst: asBool(fieldsByName['tcp.flags.reset']),
      psh: asBool(fieldsByName['tcp.flags.push']),
      ack: asBool(fieldsByName['tcp.flags.ack']),
      urg: asBool(fieldsByName['tcp.flags.urg']),
    };
    pkt.tcpWindow   = asInt(fieldsByName['tcp.window_size']);
    if (fieldsByName['tcp.checksum']) {
      const cn = parseInt(fieldsByName['tcp.checksum'], 10);
      if (!Number.isNaN(cn)) pkt.tcpChecksum = `0x${cn.toString(16).padStart(4, '0')}`;
    }
    pkt.tcpUrgPtr = asInt(fieldsByName['tcp.urgent_pointer']);

    const tcpHex = bytesToHex(fieldsByName['tcp.payload'] || '');
    if (tcpHex) {
      pkt.payload = tcpHex;
      const buf = Buffer.from(tcpHex, 'hex');
      // Full ascii needed for HTTP header parsing; truncated copy is created later
      pkt._payloadFullAscii = buf.toString('latin1');
      pkt.payloadAscii = buf.slice(0, MAX_PAYLOAD_STORE).toString('ascii').replace(/[^\x20-\x7e]/g, '.');
    }

    // Anomalies
    pkt.tcpAnomaly = detectTcpAnomaly(
      fieldsByName['tcp.analysis.retransmission'],
      fieldsByName['tcp.analysis.out_of_order'],
      fieldsByName['tcp.analysis.duplicate_ack'],
      fieldsByName['tcp.analysis.zero_window'],
    );

    // Reassembly
    const reasmIn = asInt(fieldsByName['tcp.reassembled_in']);
    if (reasmIn != null) {
      pkt.tcpContinuation = true;
      pkt.reassemblyHead = reasmIn - 1;
    }
    const reasmLen = asInt(fieldsByName['tcp.reassembled.length']);
    if (reasmLen != null) {
      pkt.reassembledTotalBytes = reasmLen;
      const segs = (fieldsByName['tcp.segment'] || '').split('\x1f').filter(Boolean).map(s => asInt(s)).filter(n => n != null);
      if (segs.length) pkt.reassembledSegments = segs.map(n => ({ pktIndex: n - 1, len: 0 }));
    }
  }

  // HTTP
  const http = reconstructHttp(fieldsByName, pkt._payloadFullAscii);
  delete pkt._payloadFullAscii;
  if (http) {
    pkt.http = http;
    if (http.kind === 'request') {
      const respIn = asInt(fieldsByName['http.response_in']);
      if (respIn != null) pkt.httpPairIndex = respIn - 1;
    } else {
      const reqIn = asInt(fieldsByName['http.request_in']);
      if (reqIn != null) pkt.httpPairIndex = reqIn - 1;
    }
  }

  // Summary
  const colInfo = fieldsByName['_ws.col.Info'];
  const colInfoUsable = colInfo && !colInfo.includes('[Malformed Packet]');
  if (colInfoUsable) {
    pkt.summary = colInfo;
  } else if (pkt.http) {
    pkt.summary = pkt.http.kind === 'request'
      ? `HTTP ${pkt.http.method} ${pkt.http.url}`
      : `HTTP ${pkt.http.status} ${pkt.http.statusText || ''}`;
  } else if (pkt.srcIP && pkt.srcPort != null) {
    const flagStr = pkt.tcpFlags
      ? Object.entries(pkt.tcpFlags).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(',')
      : '';
    pkt.summary = flagStr
      ? `${protocol} ${pkt.srcIP}:${pkt.srcPort} -> ${pkt.dstIP}:${pkt.dstPort} [${flagStr}]`
      : `${protocol} ${pkt.srcIP}:${pkt.srcPort} -> ${pkt.dstIP}:${pkt.dstPort}`;
  } else if (pkt.srcIP) {
    pkt.summary = `${protocol} ${pkt.srcIP} -> ${pkt.dstIP}`;
  } else {
    pkt.summary = protocol;
  }

  return pkt;
}

// Run tshark with -T fields, stream-parse, batch insert via callback.
function parsePcap(filePath, { onBatch, batchSize = 500, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const bin = resolveTsharkPath();
    const args = [
      '-r', filePath,
      '-2', '-n',
      '-T', 'fields',
      '-E', 'separator=\t',
      '-E', 'occurrence=a',
      '-E', 'aggregator=',
      '-E', 'quote=n',
      '-o', 'tcp.relative_sequence_numbers:FALSE',
    ];
    for (const f of FIELDS) { args.push('-e', f); }

    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const batch = [];
    let count = 0;
    const flush = () => {
      if (!batch.length) return;
      try { onBatch(batch.slice()); } catch (e) { reject(e); child.kill(); return; }
      batch.length = 0;
    };

    child.stdout.pipe(split2()).on('data', (line) => {
      if (!line) return;
      const cols = parseFieldLine(line);
      if (cols.length < FIELDS.length) {
        // pad missing trailing fields
        while (cols.length < FIELDS.length) cols.push('');
      }
      const fieldsByName = {};
      for (let i = 0; i < FIELDS.length; i++) fieldsByName[FIELDS[i]] = cols[i];
      const pkt = buildPacket(cols, fieldsByName, '', '');
      if (pkt.pktIndex == null) return;
      batch.push(pkt);
      count++;
      if (batch.length >= batchSize) {
        flush();
        if (onProgress) onProgress(count);
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`tshark exited ${code}: ${stderr.trim().slice(0, 500)}`));
      }
      flush();
      resolve({ total: count });
    });
  });
}

// Run tshark with -Y filter, return matching frame numbers (1-based) as 0-based pktIndex array
function filterFrames(filePath, displayFilter) {
  return new Promise((resolve, reject) => {
    const bin = resolveTsharkPath();
    const args = [
      '-r', filePath,
      '-2', '-n',
      '-Y', displayFilter,
      '-T', 'fields', '-e', 'frame.number',
    ];
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`tshark filter failed: ${stderr.trim().slice(0, 500)}`));
      }
      const indexes = stdout.split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => parseInt(s, 10) - 1)
        .filter(n => !Number.isNaN(n));
      resolve(indexes);
    });
  });
}

// Detect link type from legacy pcap header (pcapng returns 1 / Ethernet by default)
function readLinkType(filePath) {
  try {
    const buf = Buffer.alloc(24);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    const magic = buf.readUInt32LE(0);
    if (magic === 0xa1b2c3d4 || magic === 0xa1b23c4d) return buf.readUInt32LE(20);
    if (magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1) return buf.readUInt32BE(20);
  } catch (_) {}
  return null;
}

// Fetch a single frame's raw hex dump for the detail modal. Lazy / on-demand.
function getFrameHex(filePath, frameNumber) {
  return new Promise((resolve, reject) => {
    const bin = resolveTsharkPath();
    const args = [
      '-r', filePath, '-n', '-2',
      '-Y', `frame.number == ${frameNumber}`,
      '-T', 'json', '-x',
    ];
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`tshark hex dump failed: ${stderr.trim().slice(0, 200)}`));
      try {
        const arr = JSON.parse(stdout);
        const layers = arr?.[0]?._source?.layers;
        const frameRaw = layers?.frame_raw;
        const hex = Array.isArray(frameRaw) ? frameRaw[0] : frameRaw;
        resolve(typeof hex === 'string' ? hex : '');
      } catch (e) {
        resolve('');
      }
    });
  });
}

module.exports = { parsePcap, filterFrames, readLinkType, getFrameHex, FIELDS };
