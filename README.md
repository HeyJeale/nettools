# NetTools

A personal network debugging toolkit that integrates SSH terminal, PCAP analysis, HTTP server simulation, API testing, and ANPR/LPR data collection into a single desktop/web application.

Built with **Fastify** (Node.js backend) + **React 18** (frontend) + **Electron** (desktop wrapper).

---

## Features

### SSH & Files
- Full SSH terminal powered by xterm.js with fit and web-links add-ons
- Session management: connect to multiple hosts, switch between sessions
- SCP file manager: upload and download files over SSH

### PCAP Analyzer
- Upload and parse `.pcap` / `.pcapng` capture files
- BPF-style filter syntax: `proto`, `ip.src==`, `port==`, `contains`, `&&` / `||` / `!`
- TCP stream reassembly → HTTP promotion (mirrors Wireshark behavior)
- TCP anomaly detection: retransmissions, out-of-order, DupACK, Zero Window
- HTTP request–response pairing with arrow column visualization
- ONVIF detection and dedicated ONVIF analysis view with XML tree expansion
- Protocol statistics pie chart and traffic timeline chart
- Packet detail panel with per-layer field breakdown and XML body rendering
- Collapsible left sidebar and right detail panel

### HTTP Server
- Spin up an inbound HTTP listener on any port
- Captures incoming requests in real-time via WebSocket
- Displays method, URL, headers, body, and size
- Optional Basic Auth validation

### API Tester
- Outbound HTTP client with method, URL, headers, body, query params
- Response viewer with status, headers, and formatted body

### ANPR Server
- Inbound HTTP endpoint for ANPR (Automatic Number Plate Recognition) cameras
- Decodes and displays plate, vehicle type/color/brand, confidence, speed, coordinates, and images
- Per-record card view with image preview and save functionality
- Field filter panel with time range support
- Stable record numbering across pagination

### ANPR TCP Client
- TCP connection to LPR devices using a binary/XML protocol
- Same card-based record display as ANPR Server
- Reconnection handling (manual)

### Settings
- **Color Mode**: Dark / Light / Auto (follows OS preference) — persisted to `localStorage`
- **Cache Management**: view current server cache size (PCAP files, ANPR/LPR images), clear with freed-space feedback
- **Auto-clean on Exit**: optionally wipe all cache automatically when the tab/window is closed (default: enabled)

---

## Tech Stack

| Area | Technology |
|------|-----------|
| Desktop shell | Electron 35 |
| Backend runtime | Node.js (CommonJS) |
| Backend framework | Fastify 5 |
| PCAP parsing | `@cto.af/pcap-ng-parser` |
| SSH | `ssh2` |
| Frontend | React 18, Vite, ESM |
| Terminal | `@xterm/xterm` + add-ons |
| Charts | Recharts |
| XML parsing | `fast-xml-parser` |
| Styling | Single `App.css` with CSS custom properties (dark/light theme) |

---

## Getting Started

### Development mode

```bash
# 1. Install all dependencies
cd backend && npm install
cd ../frontend && npm install
cd ..

# 2. Start backend (port 3001)
cd backend && npm run dev

# 3. Start frontend in a separate terminal (port 5173, proxies /api/* → 3001)
cd frontend && npm run dev
```

Open `http://localhost:5173` in your browser.

### Electron desktop app (development)

```bash
# From project root
npm install          # installs Electron + electron-builder
npm start            # launches Electron, auto-detects free port
```

### Build installer

```bash
# From project root — builds frontend then packages with electron-builder
npm run build
```

Output: `dist-electron/` (Windows NSIS installer by default; macOS DMG / Linux AppImage also supported).

---

## Project Structure

```
nettools/
├── electron/
│   └── main.js               Electron entry — port discovery, backend boot, BrowserWindow
├── backend/
│   └── src/
│       ├── index.js           Fastify server entry (port 3001)
│       ├── routes/
│       │   ├── pcap.js        PCAP upload / parse / filter / stats
│       │   ├── ssh.js         SSH terminal (WebSocket)
│       │   ├── scp.js         SCP file transfer
│       │   ├── httpserver.js  Inbound HTTP server instances
│       │   ├── request.js     Outbound HTTP proxy
│       │   ├── anpr.js        ANPR HTTP server instances + image cache
│       │   ├── tcpLprClient.js ANPR TCP client connections
│       │   └── cache.js       Cache info & clear API
│       └── services/
│           ├── pcapParser.js  Packet dissection, reassembly, anomaly detection
│           └── sessions.js    SSH session registry
└── frontend/
    └── src/
        ├── App.jsx            Tab routing, sidebar, theme, auto-clean hook
        ├── App.css            All component styles (single file)
        └── components/
            ├── PcapAnalyzer.jsx
            ├── SSHTerminal.jsx
            ├── SSHWorkspace.jsx
            ├── HttpServer.jsx
            ├── ApiTester.jsx
            ├── FileManager.jsx
            ├── AnprServer.jsx
            ├── AnprTcpClient.jsx
            └── Settings.jsx
```

---

## License

MIT
