'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parsePcap, filterFrames } = require('../src/services/tsharkAdapter');
const { checkTshark } = require('../src/services/tsharkBin');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.pcapng');

let tsharkOk = true;
try { checkTshark(); } catch (_) { tsharkOk = false; }

const maybeDescribe = tsharkOk ? describe : describe.skip;

maybeDescribe('tsharkAdapter', () => {
  test('parses a pcap into Packet objects with required fields', async () => {
    const packets = [];
    const { total } = await parsePcap(FIXTURE, { onBatch: (b) => packets.push(...b) });
    expect(total).toBeGreaterThan(0);
    expect(packets.length).toBe(total);

    const sample = packets[0];
    expect(typeof sample.pktIndex).toBe('number');
    expect(typeof sample.ts).toBe('number');
    expect(typeof sample.protocol).toBe('string');
    expect(typeof sample.summary).toBe('string');
  });

  test('filterFrames returns 0-based indexes', async () => {
    const idxs = await filterFrames(FIXTURE, 'frame.number == 1');
    expect(idxs).toEqual([0]);
  });

  test('filterFrames rejects invalid expression', async () => {
    await expect(filterFrames(FIXTURE, '!!! bogus')).rejects.toThrow();
  });
});
