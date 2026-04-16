'use strict';
require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// Allow uploads dir to be overridden by Electron (or any parent process)
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

async function start() {
  await fastify.register(require('@fastify/cors'), { origin: true });
  await fastify.register(require('@fastify/websocket'));
  await fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  await fastify.register(require('./routes/ssh'), { prefix: '/api/ssh' });
  await fastify.register(require('./routes/scp'), { prefix: '/api/scp' });
  await fastify.register(require('./routes/pcap'), { prefix: '/api/pcap' });
  await fastify.register(require('./routes/request'), { prefix: '/api/request' });
  await fastify.register(require('./routes/httpserver'), { prefix: '/api/httpserver' });
  await fastify.register(require('./routes/anpr'), { prefix: '/api/anpr' });
  await fastify.register(require('./routes/tcpLprClient'), { prefix: '/api/tcplpr' });
  await fastify.register(require('./routes/cache'), {
    prefix: '/api/cache',
    clearPcapStore: require('./routes/pcap').clearStore,
  });

  // Health check — used by Electron to know when the backend is ready
  fastify.get('/api/health', async () => ({ ok: true }));

  // Serve built frontend when running inside Electron
  if (process.env.FRONTEND_DIST) {
    await fastify.register(require('@fastify/static'), {
      root: process.env.FRONTEND_DIST,
      prefix: '/',
      // Let API routes take priority; serve index.html for unknown paths (SPA fallback)
      wildcard: false,
    });
    // SPA fallback — any unmatched GET returns index.html
    fastify.setNotFoundHandler(async (req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not found' });
    });
  }

  // Native OS folder picker — spawns a system dialog, returns selected path
  fastify.get('/api/pick-folder', async (req, reply) => {
    return new Promise((resolve) => {
      const platform = os.platform();
      let cmd, args;

      if (platform === 'win32') {
        // Windows: PowerShell FolderBrowserDialog
        const script = [
          'Add-Type -AssemblyName System.Windows.Forms;',
          '[System.Windows.Forms.Application]::EnableVisualStyles();',
          '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
          '$d.Description = "Select SSH log output directory";',
          '$d.UseDescriptionForTitle = $true;',
          '$d.ShowNewFolderButton = $true;',
          'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK)',
          '{ Write-Output $d.SelectedPath }',
        ].join(' ');
        cmd = 'powershell';
        args = ['-NoProfile', '-Command', script];
      } else if (platform === 'darwin') {
        // macOS: AppleScript choose folder
        cmd = 'osascript';
        args = ['-e', 'POSIX path of (choose folder with prompt "Select SSH log output directory")'];
      } else {
        // Linux: try zenity (GNOME), fallback handled client-side
        cmd = 'zenity';
        args = ['--file-selection', '--directory', '--title=Select SSH log output directory'];
      }

      execFile(cmd, args, { timeout: 60000 }, (err, stdout) => {
        const p = stdout ? stdout.trim() : '';
        resolve({ path: p || null });
      });
    });
  });

  const port = parseInt(process.env.PORT || '3001');
  const host = process.env.HOST || '0.0.0.0';
  await fastify.listen({ port, host });

  // Graceful shutdown — cache cleanup is controlled by the frontend (nt-auto-clean setting)
  process.on('SIGINT',  () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

start().catch((err) => { console.error(err); process.exit(1); });

