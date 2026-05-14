'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLATFORM = process.platform;
const TSHARK_EXE = PLATFORM === 'win32' ? 'tshark.exe' : 'tshark';

// Known install locations for development mode
const DEV_PATHS = PLATFORM === 'win32'
  ? ['C:\\Program Files\\Wireshark\\tshark.exe', 'C:\\Program Files (x86)\\Wireshark\\tshark.exe']
  : PLATFORM === 'darwin'
    ? ['/Applications/Wireshark.app/Contents/MacOS/tshark', '/opt/homebrew/bin/tshark', '/usr/local/bin/tshark']
    : ['/usr/bin/tshark', '/usr/local/bin/tshark'];

let cached = null;

function resolveTsharkPath() {
  if (cached) return cached;

  // Packaged: bundled binary next to app resources
  if (process.env.NETTOOLS_PACKAGED && process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, 'tshark', TSHARK_EXE);
    if (fs.existsSync(bundled)) { cached = bundled; return cached; }
  }

  // Explicit override
  if (process.env.TSHARK_PATH && fs.existsSync(process.env.TSHARK_PATH)) {
    cached = process.env.TSHARK_PATH;
    return cached;
  }

  // Dev mode: well-known install paths
  for (const p of DEV_PATHS) {
    if (fs.existsSync(p)) { cached = p; return cached; }
  }

  // Fall back to PATH lookup
  cached = TSHARK_EXE;
  return cached;
}

function checkTshark() {
  const bin = resolveTsharkPath();
  const res = spawnSync(bin, ['-v'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    throw new Error(`tshark not found or not executable (${bin}). Install Wireshark or set TSHARK_PATH.`);
  }
  const firstLine = (res.stdout || '').split('\n')[0];
  const m = firstLine.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Unable to parse tshark version: ${firstLine}`);
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  if (major < 4 || (major === 4 && minor < 4)) {
    throw new Error(`tshark ${m[0]} too old; requires >= 4.4`);
  }
  return { path: bin, version: m[0] };
}

module.exports = { resolveTsharkPath, checkTshark };
