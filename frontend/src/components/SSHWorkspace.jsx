import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useT } from '../i18n.js';

// ── Terminal color themes ─────────────────────────────────────────────────────
const TERM_DARK = {
  background: '#06080f', foreground: '#cdd9e5',
  cursor: '#7c6af5', selectionBackground: '#3730a3',
  black: '#484f58', red: '#ff7b72', green: '#3fb950',
  yellow: '#d29922', blue: '#7c6af5', magenta: '#bc8cff',
  cyan: '#22d3ee', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
  brightCyan: '#39c5cf', brightWhite: '#cdd9e5',
};
const TERM_LIGHT = {
  background: '#f8fafc', foreground: '#1e293b',
  cursor: '#4f46e5', selectionBackground: '#c7d2fe',
  black: '#334155', red: '#dc2626', green: '#16a34a',
  yellow: '#d97706', blue: '#4f46e5', magenta: '#7c3aed',
  cyan: '#0891b2', white: '#64748b',
  brightBlack: '#475569', brightRed: '#b91c1c', brightGreen: '#15803d',
  brightYellow: '#b45309', brightBlue: '#3730a3', brightMagenta: '#6d28d9',
  brightCyan: '#0e7490', brightWhite: '#1e293b',
};
function getTermTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? TERM_LIGHT : TERM_DARK;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtSize(b) {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

function glassMove(e) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--sx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--sy', `${e.clientY - r.top}px`);
}

// SVG icons
function IconUp()      { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 12V4M4 8l4-4 4 4"/></svg>; }
function IconRefresh() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 8A5.5 5.5 0 112.5 5M2 2v3h3"/></svg>; }
function IconDownload(){ return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v7M5 7l3 3 3-3M2 13h12"/></svg>; }
function IconPause()   { return <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/></svg>; }
function IconPlay()    { return <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2.5l10 5.5-10 5.5V2.5z"/></svg>; }
function IconFolder()  { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4.5A.75.75 0 011.75 3.75h3.586c.199 0 .39.079.53.22l1.414 1.414a.75.75 0 00.53.22H14.25a.75.75 0 01.75.75V13a.75.75 0 01-.75.75H1.75A.75.75 0 011 13V4.5z"/></svg>; }
function IconClear()   { return <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M2 2l12 12M14 2L2 14"/></svg>; }

// ── FilePanel ─────────────────────────────────────────────────────────────────
function FilePanel({ sessionId }) {
  const t = useT();
  const [remotePath, setRemotePath] = useState('/');
  const [pathInput, setPathInput] = useState('/');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (sessionId) loadDir('/');
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDir(p) {
    setLoading(true); setError('');
    try {
      const { data } = await axios.get('/api/scp/list', { params: { sessionId, remotePath: p } });
      setFiles(data.files);
      setRemotePath(p); setPathInput(p);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setLoading(false); }
  }

  function goUp() {
    const parts = remotePath.split('/').filter(Boolean);
    parts.pop();
    loadDir(parts.length ? '/' + parts.join('/') : '/');
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploadStatus(t.sshUploading);
    const fd = new FormData();
    fd.append('sessionId', sessionId);
    fd.append('remotePath', remotePath);
    fd.append('file', file);
    try {
      await axios.post('/api/scp/upload', fd);
      setUploadStatus(t.sshUploadComplete);
      loadDir(remotePath);
    } catch (err) {
      setUploadStatus(t.sshFailed(err.response?.data?.error || err.message));
    }
  }

  function handleDownload(name) {
    const p = (remotePath === '/' || remotePath === '.') ? `/${name}` : `${remotePath}/${name}`;
    const a = document.createElement('a');
    a.href = `/api/scp/download?sessionId=${encodeURIComponent(sessionId)}&remotePath=${encodeURIComponent(p)}`;
    a.download = name; a.click();
  }

  return (
    <div className="file-panel">
      <div className="panel-header">
        <span className="panel-title">{t.sshFileTransfer}</span>
        <div className="path-bar">
          <button className="icon-btn" title={t.sshParentDir} onClick={goUp}><IconUp /></button>
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadDir(pathInput)}
          />
          <button className="icon-btn" onClick={() => loadDir(remotePath)} title={t.refresh}><IconRefresh /></button>
        </div>
      </div>

      {error && <div className="inline-error" style={{ margin: '0 10px 6px' }}>{error}</div>}

      <div className="file-list-wrap">
        {loading ? (
          <div className="empty-state">{t.loading}</div>
        ) : (
          <table className="file-table">
            <thead>
              <tr><th>{t.name}</th><th>{t.type}</th><th>{t.sshPerms}</th><th>{t.sshOwner}</th><th>{t.size}</th><th>{t.modified}</th><th></th></tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td>
                    {f.isDir
                      ? <span className="dir-link" onClick={() => loadDir(remotePath === '/' ? `/${f.name}` : `${remotePath}/${f.name}`)}>
                          <svg className="file-icon-dir" width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5L6.25 1.5a.75.75 0 00-.56-.25H1.75z"/></svg>
                          {f.name}
                        </span>
                      : <span className="file-row-name">
                          <svg className="file-icon-file" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-9.5A1.75 1.75 0 012 14.25V1.75z"/></svg>
                          {f.name}
                        </span>}
                  </td>
                  <td>
                    <span className={`ftype-badge ${f.isDir ? 'dir' : f.isLink ? 'link' : 'file'}`}>
                      {f.fileType || (f.isDir ? 'dir' : 'file')}
                    </span>
                  </td>
                  <td className="cell-mono">{f.perms || '—'}</td>
                  <td className="cell-muted">{f.owner || '—'}</td>
                  <td className="cell-muted">{fmtSize(f.size)}</td>
                  <td className="cell-muted">{f.mtime || '—'}</td>
                  <td>
                    {!f.isDir && (
                      <button className="row-btn" onClick={() => handleDownload(f.name)} title={t.download}>
                        <IconDownload />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {files.length === 0 && !loading && (
                <tr><td colSpan={7} className="empty-state">{t.sshEmptyDir}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div
        className="upload-zone"
        onClick={() => fileInputRef.current.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleUpload({ target: { files: e.dataTransfer.files } }); }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 11V3M4 6l4-4 4 4"/><path d="M2 13h12"/>
        </svg>
        <span>{t.sshDropUpload(remotePath)}</span>
      </div>
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
      {uploadStatus && (
        <div className={`upload-status ${uploadStatus === t.sshUploadComplete ? 'ok' : 'err'}`}>
          {uploadStatus}
        </div>
      )}
    </div>
  );
}

// ── SSHWorkspace ──────────────────────────────────────────────────────────────
export default function SSHWorkspace({ sessionId, setSessionId, connected, setConnected, connInfo, setConnInfo }) {
  const t = useT();
  const [form, setForm] = useState({ host: '', port: '22', username: '', password: '', logDir: '' });
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [filePaneWidth, setFilePaneWidth] = useState(600);
  const [fileOpen, setFileOpen] = useState(true);
  const [logPath, setLogPath] = useState(null);
  const [logEnabled, setLogEnabled] = useState(true);

  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  const dragRef = useRef(null);
  const themeObserverRef = useRef(null);

  function startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = filePaneWidth;
    function onMove(ev) {
      const delta = startX - ev.clientX;
      setFilePaneWidth(Math.max(260, Math.min(700, startW + delta)));
      fitRef.current?.fit();
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      fitRef.current?.fit();
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  useEffect(() => {
    if (!connected || !sessionId) return;
    let term, ws;

    async function boot() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      await import('@xterm/xterm/css/xterm.css');

      term = new Terminal({
        cursorBlink: true, fontSize: 13,
        fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
        theme: getTermTheme(),
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(termRef.current);
      fitAddon.fit();
      xtermRef.current = term;
      fitRef.current = fitAddon;

      themeObserverRef.current = new MutationObserver(() => {
        term.options.theme = getTermTheme();
      });
      themeObserverRef.current.observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme'],
      });

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/ssh/terminal/${sessionId}`);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'data') term.write(atob(msg.data));
        else if (msg.type === 'connected' && msg.logPath) setLogPath(msg.logPath);
        else if (msg.type === 'log_status') { setLogEnabled(msg.enabled); if (msg.path) setLogPath(msg.path); }
        else if (msg.type === 'error') term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        else if (msg.type === 'closed') term.write(`\r\n\x1b[33m${t.sshConnClosed}\x1b[0m\r\n`);
      };
      ws.onclose = () => term.write(`\r\n\x1b[33m${t.sshWsClosed}\x1b[0m\r\n`);

      term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'data', data: btoa(d) })));
      term.onResize(({ cols, rows }) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'resize', cols, rows })));
    }

    boot().catch(console.error);
    const onResize = () => fitRef.current?.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      themeObserverRef.current?.disconnect();
      themeObserverRef.current = null;
      ws?.close();
      term?.dispose();
      setLogPath(null);
      setLogEnabled(true);
    };
  }, [connected, sessionId]);

  useEffect(() => {
    const timer = setTimeout(() => fitRef.current?.fit(), 30);
    return () => clearTimeout(timer);
  }, [fileOpen]);

  function toggleLog() {
    const next = !logEnabled;
    setLogEnabled(next);
    wsRef.current?.send(JSON.stringify({ type: 'log_toggle', enable: next }));
  }

  async function pickFolder() {
    setPickingFolder(true);
    try {
      const { data } = await axios.get('/api/pick-folder');
      if (data.path) setForm(f => ({ ...f, logDir: data.path }));
    } catch (_) {}
    finally { setPickingFolder(false); }
  }

  async function handleConnect(e) {
    e.preventDefault(); setError(''); setConnecting(true);
    try {
      const { data } = await axios.post('/api/ssh/connect', {
        host: form.host, port: Number(form.port),
        username: form.username, password: form.password,
        ...(form.logDir.trim() ? { logDir: form.logDir.trim() } : {}),
      });
      setSessionId(data.sessionId);
      setConnInfo({ host: form.host, username: form.username });
      setConnected(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setConnecting(false); }
  }

  async function handleDisconnect() {
    if (sessionId) await axios.delete(`/api/ssh/disconnect/${sessionId}`).catch(() => {});
    wsRef.current?.close();
    xtermRef.current?.dispose();
    xtermRef.current = null;
    setSessionId(null); setConnected(false); setConnInfo(null);
    setLogPath(null); setLogEnabled(true);
  }

  if (!connected) {
    return (
      <div className="connect-screen">
        <form className="connect-card" onSubmit={handleConnect} onMouseMove={glassMove}>
          <div className="connect-card-header">
            <h2>{t.sshConnectTitle}</h2>
            <p>{t.sshAuthMethod}</p>
          </div>
          <div className="field-group">
            <label>{t.sshHost}</label>
            <input placeholder="192.168.1.1" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
          </div>
          <div className="field-row">
            <div className="field-group" style={{ width: 90 }}>
              <label>{t.port}</label>
              <input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            </div>
            <div className="field-group" style={{ flex: 1 }}>
              <label>{t.username}</label>
              <input placeholder="root" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </div>
          </div>
          <div className="field-group">
            <label>{t.password}</label>
            <input type="password" placeholder="••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <div className="field-group">
            <label>{t.sshLogDir} <span style={{ fontWeight: 400, opacity: 0.55 }}>{t.authOptional}</span></label>
            <div className="folder-pick-row">
              <input
                readOnly
                placeholder={t.sshLogDirPlaceholder}
                value={form.logDir}
                style={{ cursor: 'pointer', flex: 1 }}
                onClick={pickFolder}
              />
              <button
                type="button"
                className="btn-secondary folder-pick-btn"
                onClick={pickFolder}
                disabled={pickingFolder}
                title={t.sshBrowse}
              >
                <IconFolder />
                {pickingFolder ? t.sshPicking : t.sshBrowse}
              </button>
              {form.logDir && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setForm(f => ({ ...f, logDir: '' }))}
                  title={t.clear}
                >
                  <IconClear />
                </button>
              )}
            </div>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <button className="btn-primary" type="submit" disabled={connecting}>
            {connecting ? t.sshConnecting : t.connect}
          </button>
        </form>
      </div>
    );
  }

  const logFileName = logPath ? logPath.split(/[/\\]/).pop() : null;

  return (
    <div className="workspace">
      <div className="workspace-toolbar">
        <span className="conn-label">
          <span className="badge-dot" /> {connInfo?.username}@{connInfo?.host}
        </span>

        {logPath && (
          <div className="log-indicator">
            <span className={`log-dot ${logEnabled ? 'recording' : 'paused'}`} />
            <span className="log-path" title={logPath}>{logFileName}</span>
            <button
              className="icon-btn"
              onClick={toggleLog}
              title={logEnabled ? t.sshPauseLog : t.sshResumeLog}
            >
              {logEnabled ? <IconPause /> : <IconPlay />}
            </button>
            <a
              href={`/api/ssh/log/${sessionId}`}
              download={logFileName}
              className="icon-btn"
              title={t.sshDownloadLog}
            >
              <IconDownload />
            </a>
          </div>
        )}

        <button className="btn-danger" onClick={handleDisconnect}>{t.disconnect}</button>
      </div>

      <div className="workspace-body">
        <div className="terminal-pane" onMouseMove={glassMove}>
          <div ref={termRef} className="xterm-host" />
        </div>

        <div
          ref={dragRef}
          className={`resize-handle${fileOpen ? '' : ' resize-handle-hidden'}`}
          onMouseDown={fileOpen ? startResize : undefined}
        />

        <div
          className={`file-pane${fileOpen ? '' : ' file-pane-collapsed'}`}
          style={{ width: fileOpen ? filePaneWidth : 0 }}
          onMouseMove={glassMove}
        >
          <button className="file-pane-toggle" onClick={() => setFileOpen(false)} title={t.sshCollapseFiles}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2l4 4-4 4"/>
            </svg>
          </button>
          <FilePanel sessionId={sessionId} />
        </div>

        {!fileOpen && (
          <div className="file-pane-edge-zone">
            <button className="file-pane-toggle" onClick={() => setFileOpen(true)} title={t.sshExpandFiles}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2L4 6l4 4"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
