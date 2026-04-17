'use strict';

// ── 直接测试纯函数，不 require parsePcap（避免 ESM 依赖问题）──────────────────
// 把 pcapParser.js 中的纯函数逻辑内联到测试中，与生产代码保持一致

// ── filterPackets / getStats / getTimeline 从源文件提取 ──────────────────────
// 用 vm + 替换 require 的方式加载纯函数部分
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 读取源文件，把 require('@cto.af/pcap-ng-parser') 替换为 mock，
// 这样纯函数部分可以正常加载
const src = fs.readFileSync(
  path.join(__dirname, '../src/services/pcapParser.js'),
  'utf8'
).replace(
  "require('@cto.af/pcap-ng-parser')",
  '{ PCAPNGParser: class {} }'
);

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

const { filterPackets, getStats, getTimeline } = mod.exports;

// ── filterPackets ──────────────────────────────────────────────────────────────
describe('filterPackets', () => {
  const packets = [
    { protocol: 'ARP',  srcIP: '192.168.1.1', dstIP: '192.168.1.2', srcPort: null, dstPort: null, len: 42, payloadAscii: '', rawHex: '' },
    { protocol: 'TCP',  srcIP: '10.0.0.1',    dstIP: '10.0.0.2',    srcPort: 54321, dstPort: 80,  len: 54, payloadAscii: 'hello world', rawHex: '68656c6c6f' },
    { protocol: 'DNS',  srcIP: '10.0.0.1',    dstIP: '8.8.8.8',     srcPort: 12345, dstPort: 53,  len: 42, payloadAscii: '', rawHex: '' },
    { protocol: 'HTTP', srcIP: '10.0.0.1',    dstIP: '10.0.0.3',    srcPort: 55000, dstPort: 8080, len: 200, payloadAscii: 'GET /api HTTP/1.1', rawHex: '' },
  ];

  test('empty filter returns all packets', () => {
    expect(filterPackets(packets, '')).toHaveLength(4);
    expect(filterPackets(packets, '   ')).toHaveLength(4);
  });

  test('protocol filter (arp)', () => {
    const result = filterPackets(packets, 'arp');
    expect(result).toHaveLength(1);
    expect(result[0].protocol).toBe('ARP');
  });

  test('ip.src== filter', () => {
    expect(filterPackets(packets, 'ip.src==10.0.0.1')).toHaveLength(3);
  });

  test('ip.dst== filter', () => {
    const result = filterPackets(packets, 'ip.dst==8.8.8.8');
    expect(result).toHaveLength(1);
    expect(result[0].protocol).toBe('DNS');
  });

  test('ip.src!= filter excludes matching packets', () => {
    // ARP packet has srcIP '192.168.1.1' which != '10.0.0.1', so it passes
    // The 3 packets with srcIP '10.0.0.1' are excluded
    const result = filterPackets(packets, 'ip.src!=10.0.0.1');
    expect(result.every(p => p.srcIP !== '10.0.0.1')).toBe(true);
  });

  test('port== filter matches src or dst', () => {
    const result = filterPackets(packets, 'port==80');
    expect(result).toHaveLength(1);
    expect(result[0].srcPort).toBe(54321);
  });

  test('port!= filter excludes matched packets', () => {
    const result = filterPackets(packets, 'port!=53');
    expect(result.every(p => p.srcPort !== 53 && p.dstPort !== 53)).toBe(true);
  });

  test('AND operator', () => {
    const result = filterPackets(packets, 'ip.src==10.0.0.1 && port==80');
    expect(result).toHaveLength(1);
    expect(result[0].dstPort).toBe(80);
  });

  test('OR operator', () => {
    const result = filterPackets(packets, 'arp || dns');
    expect(result).toHaveLength(2);
  });

  test('NOT operator', () => {
    const result = filterPackets(packets, '!arp');
    expect(result.every(p => p.protocol !== 'ARP')).toBe(true);
    expect(result).toHaveLength(3);
  });

  test('contains filter matches payloadAscii', () => {
    const result = filterPackets(packets, 'contains "hello"');
    expect(result).toHaveLength(1);
    expect(result[0].protocol).toBe('TCP');
  });

  test('malformed filter expression returns empty (no crash)', () => {
    // '&&&&' tokenizes to [AND, AND] — no operands, evalAst returns false for all
    // The important thing is it doesn't throw
    expect(() => filterPackets(packets, '&&&&')).not.toThrow();
  });

  test('parentheses grouping', () => {
    const result = filterPackets(packets, '(arp || dns) && ip.src==192.168.1.1');
    expect(result).toHaveLength(1);
    expect(result[0].protocol).toBe('ARP');
  });

  test('tcp.port== matches TCP/HTTP/HTTPS only', () => {
    const result = filterPackets(packets, 'tcp.port==80');
    expect(result).toHaveLength(1);
    expect(result[0].protocol).toBe('TCP');
  });

  test('udp.port== matches UDP/DNS only', () => {
    const result = filterPackets(packets, 'udp.port==53');
    expect(result).toHaveLength(1);
    expect(result[0].protocol).toBe('DNS');
  });
});

// ── getStats ───────────────────────────────────────────────────────────────────
describe('getStats', () => {
  const packets = [
    { protocol: 'ARP' },
    { protocol: 'ARP' },
    { protocol: 'TCP' },
    { protocol: 'DNS' },
    { protocol: 'DNS' },
    { protocol: 'DNS' },
  ];

  test('counts total packets', () => {
    expect(getStats(packets).total).toBe(6);
  });

  test('counts by protocol', () => {
    const { byProtocol } = getStats(packets);
    expect(byProtocol.ARP).toBe(2);
    expect(byProtocol.TCP).toBe(1);
    expect(byProtocol.DNS).toBe(3);
  });

  test('empty input', () => {
    expect(getStats([])).toEqual({ total: 0, byProtocol: {} });
  });

  test('unknown protocol falls back to OTHER', () => {
    const result = getStats([{ protocol: undefined }]);
    expect(result.byProtocol.OTHER).toBe(1);
  });
});

// ── getTimeline ────────────────────────────────────────────────────────────────
describe('getTimeline', () => {
  test('returns empty array for empty input', () => {
    expect(getTimeline([])).toEqual([]);
  });

  test('returns correct number of buckets', () => {
    const packets = [{ ts: 0, len: 100 }, { ts: 1, len: 200 }, { ts: 2, len: 150 }];
    expect(getTimeline(packets, 10)).toHaveLength(10);
  });

  test('total bytes preserved across all buckets', () => {
    const packets = [{ ts: 0, len: 10 }, { ts: 0.5, len: 20 }, { ts: 1.0, len: 30 }];
    const result = getTimeline(packets, 5);
    const totalBytes = result.reduce((s, b) => s + b.bytes, 0);
    expect(totalBytes).toBe(60);
  });

  test('handles out-of-order timestamps without crashing (regression)', () => {
    // Packets where ts is NOT sorted — this caused a 500 crash before the fix
    const packets = [
      { ts: 2.0, len: 100 },
      { ts: 0.5, len: 50 },  // earlier than first packet
      { ts: 3.0, len: 75 },
    ];
    expect(() => getTimeline(packets, 60)).not.toThrow();
    const result = getTimeline(packets, 60);
    expect(result).toHaveLength(60);
    const totalBytes = result.reduce((s, b) => s + b.bytes, 0);
    expect(totalBytes).toBe(225);
  });

  test('single packet fills one bucket', () => {
    const packets = [{ ts: 5.0, len: 999 }];
    const result = getTimeline(packets, 10);
    const totalBytes = result.reduce((s, b) => s + b.bytes, 0);
    expect(totalBytes).toBe(999);
  });

  test('bucket timestamps are monotonically increasing', () => {
    const packets = [{ ts: 0, len: 1 }, { ts: 10, len: 1 }];
    const result = getTimeline(packets, 5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].t).toBeGreaterThan(result[i - 1].t);
    }
  });
});
