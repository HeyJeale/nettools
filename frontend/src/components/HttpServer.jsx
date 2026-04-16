import React, { useState, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import axios from 'axios';

const METHOD_COLORS = {
  GET: '#3fb950', POST: '#38bdf8', PUT: '#fbbf24',
  PATCH: '#c084fc', DELETE: '#f87171',
  HEAD: '#94a3b8', OPTIONS: '#94a3b8',
};

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function fmtSize(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  return `${(b / 1024).toFixed(1)} KB`;
}

// ── RequestEntry ──────────────────────────────────────────────────────────────
function RequestEntry({ entry, index }) {
  const [open, setOpen] = useState(true);
  const color = METHOD_COLORS[entry.method] || 'var(--text-2)';

  return (
    <div className={`hs-entry ${open ? 'open' : ''}`}>
      <button className="hs-entry-header" onClick={() => setOpen(o => !o)}>
        <span className="hs-entry-index">#{index}</span>
        <span className="hs-method-badge" style={{ color, borderColor: color + '44', background: color + '18' }}>
          {entry.method}
        </span>
        <span className="hs-entry-url">{entry.url}</span>
        <span className="hs-entry-size">{fmtSize(entry.bodySize)}</span>
        <span className="hs-entry-time">{fmtTime(entry.ts)}</span>
        <svg className="hs-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="hs-entry-body">
          <div className="hs-section-label">Headers</div>
          <table className="hs-headers-table">
            <tbody>
              {Object.entries(entry.headers).map(([k, v]) => (
                <tr key={k}><td className="hs-hk">{k}</td><td className="hs-hv">{v}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="hs-section-label" style={{ marginTop: 10 }}>
            Body
            {entry.bodySize > 0 && <span className="hs-body-size">{fmtSize(entry.bodySize)}</span>}
          </div>
          {entry.body
            ? <pre className="hs-body-pre">{entry.body}</pre>
            : <div className="hs-body-empty">— empty body —</div>
          }
        </div>
      )}
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function HttpServer() {
  const [port,     setPort]     = useState('8080');
  const [path,     setPath]     = useState('/httpServer');
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');

  const [running,    setRunning]    = useState(false);
  const [instanceId, setInstanceId] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [error,      setError]      = useState('');
  const [requests,   setRequests]   = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);

  const wsRef        = useRef(null);
  const parentRef    = useRef(null);
  const instanceRef  = useRef(null);

  const virtualizer = useVirtualizer({
    count: requests.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  useEffect(() => { instanceRef.current = instanceId; }, [instanceId]);

  // Auto-scroll to newest item
  useEffect(() => {
    if (autoScroll && requests.length > 0) {
      virtualizer.scrollToIndex(requests.length - 1, { behavior: 'smooth' });
    }
  }, [requests.length, autoScroll]);

  useEffect(() => () => wsRef.current?.close(), []);

  useEffect(() => {
    function onUnload() {
      if (instanceRef.current) navigator.sendBeacon(`/api/httpserver/stop/${instanceRef.current}`);
    }
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  async function handleStart() {
    setError('');
    try {
      const { data } = await axios.post('/api/httpserver/start', {
        port: Number(port), path,
        authUser: authUser.trim(), authPass: authPass.trim(),
      });
      setInstanceId(data.instanceId);
      setServerInfo({ port: data.port, path: data.path });
      setRequests([]);
      setRunning(true);

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/httpserver/stream/${data.instanceId}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'request') setRequests(prev => [...prev, msg]);
        else if (msg.type === 'stopped') setRunning(false);
      };
      ws.onclose = () => setRunning(false);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function handleStop() {
    if (!instanceId) return;
    try { await axios.delete(`/api/httpserver/stop/${instanceId}`); } catch {}
    wsRef.current?.close();
    setRunning(false); setInstanceId(null); setServerInfo(null);
  }

  return (
    <div className="hs-root">
      {/* ── Config panel ── */}
      <div className="hs-config-bar">
        <div className="hs-config-fields">
          <div className="hs-field hs-field-port">
            <label className="hs-label">Port</label>
            <input className="hs-input" value={port}
              onChange={e => setPort(e.target.value)} disabled={running} placeholder="8080" />
          </div>
          <div className="hs-field" style={{ flex: 2 }}>
            <label className="hs-label">Listen path</label>
            <input className="hs-input" value={path}
              onChange={e => setPath(e.target.value)} disabled={running} placeholder="/httpServer" />
          </div>
          <div className="hs-field-sep" />
          <div className="hs-field">
            <label className="hs-label">Auth user <span className="hs-optional">(optional)</span></label>
            <input className="hs-input" value={authUser}
              onChange={e => setAuthUser(e.target.value)} disabled={running} placeholder="username" autoComplete="off" />
          </div>
          <div className="hs-field">
            <label className="hs-label">Auth password</label>
            <input className="hs-input" type="password" value={authPass}
              onChange={e => setAuthPass(e.target.value)} disabled={running} placeholder="••••••••" autoComplete="off" />
          </div>
        </div>
        <div className="hs-config-actions">
          {!running ? (
            <button className="btn-primary hs-start-btn" onClick={handleStart}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2.5l10 5.5-10 5.5V2.5z"/></svg>
              Start
            </button>
          ) : (
            <button className="btn-danger hs-stop-btn" onClick={handleStop}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>
              Stop
            </button>
          )}
        </div>
      </div>

      {error && <div className="inline-error" style={{ margin: '0 0 8px' }}>{error}</div>}

      {/* ── Status bar ── */}
      {running && serverInfo && (
        <div className="hs-status-bar">
          <span className="hs-status-dot" />
          <span className="hs-status-text">
            Listening on port <strong>{serverInfo.port}</strong> → path <code>{serverInfo.path}</code>
            {authUser.trim() && <span className="hs-auth-badge">Basic Auth</span>}
          </span>
          <div style={{ flex: 1 }} />
          <span className="hs-req-count">{requests.length} request{requests.length !== 1 ? 's' : ''}</span>
          <label className="api-opt-check">
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
            <span className="api-opt-check-label">Auto-scroll</span>
          </label>
          {requests.length > 0 && (
            <button className="btn-xs danger" onClick={() => setRequests([])}>Clear</button>
          )}
        </div>
      )}

      {/* ── Request log (virtualized) ── */}
      <div ref={parentRef} className="hs-log">
        {!running && requests.length === 0 && (
          <div className="hs-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
            <p>Configure and start the server to receive requests</p>
          </div>
        )}
        {running && requests.length === 0 && (
          <div className="hs-empty">
            <span className="hs-pulse-ring" />
            <p>Waiting for incoming requests…</p>
          </div>
        )}
        {requests.length > 0 && (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map(vItem => (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vItem.start}px)` }}
              >
                <RequestEntry entry={requests[vItem.index]} index={vItem.index + 1} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
