import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useT } from '../i18n.js';

const PAGE_SIZE = 50;

const BODY_FIELD_KEYS = [
  { key: 'plate',        tKey: 'plate' },
  { key: 'vehicleType',  tKey: 'vehicleType' },
  { key: 'vehicleColor', tKey: 'vehicleColor' },
  { key: 'plateColor',   tKey: 'plateColor' },
  { key: 'brand',        tKey: 'brand' },
  { key: 'confidence',   tKey: 'confidence' },
  { key: 'speed',        tKey: 'speed' },
  { key: 'direction',    tKey: 'direction' },
  { key: 'region',       tKey: 'region' },
  { key: 'roiNumber',    tKey: 'roi' },
  { key: 'plateType',    tKey: 'plateType' },
  { key: 'distance',     tKey: 'distance' },
  { key: 'azimuth',      tKey: 'azimuth' },
  { key: 'vehicleCount', tKey: 'vehicleCount' },
  { key: 'width',        tKey: 'width' },
  { key: 'height',       tKey: 'height' },
  { key: 'x1',           tKey: null, label: 'X1' },
  { key: 'y1',           tKey: null, label: 'Y1' },
  { key: 'x2',           tKey: null, label: 'X2' },
  { key: 'y2',           tKey: null, label: 'Y2' },
  { key: 'guid',         tKey: 'guid' },
  { key: 'time',         tKey: 'time' },
];

const FILTER_FIELD_KEYS = [
  { key: 'plate',        tKey: 'plate' },
  { key: 'vehicleType',  tKey: 'vehicleType' },
  { key: 'vehicleColor', tKey: 'vehicleColor' },
  { key: 'plateColor',   tKey: 'plateColor' },
  { key: 'brand',        tKey: 'brand' },
  { key: 'region',       tKey: 'region' },
  { key: 'direction',    tKey: 'direction' },
];

const EMPTY_FILTERS = {
  plate: '', vehicleType: '', vehicleColor: '', plateColor: '',
  brand: '', region: '', direction: '',
  timeStart: '', timeEnd: '',
};

function hasActiveFilter(f) {
  return Object.values(f).some(v => v.trim() !== '');
}

function applyFilters(records, filters) {
  return records.filter(r => {
    for (const { key } of FILTER_FIELD_KEYS) {
      const fval = filters[key]?.trim();
      if (!fval) continue;
      if (!(r[key] ?? '').toString().toLowerCase().includes(fval.toLowerCase())) return false;
    }
    const ts = filters.timeStart?.trim();
    const te = filters.timeEnd?.trim();
    if (ts && r.time && r.time < ts) return false;
    if (te && r.time && r.time > te) return false;
    return true;
  });
}

// ── Single record card ────────────────────────────────────────────────────────
function TcpLprCard({ record, connId, onImgClick }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className={`anpr-card${open ? ' open' : ''}`}>
      <button className="anpr-card-hdr" onClick={() => setOpen(o => !o)}>
        <span className="anpr-card-idx">#{record._seq}</span>
        <span className="anpr-card-plate">{record.plate || '—'}</span>
        {record.vehicleType  && <span className="anpr-card-tag">{record.vehicleType}</span>}
        {record.vehicleColor && <span className="anpr-card-tag">{record.vehicleColor}</span>}
        {record.brand && record.brand !== 'Unknown' && (
          <span className="anpr-card-tag anpr-tag-dim">{record.brand}</span>
        )}
        <span className="anpr-card-spacer" />
        <span className="anpr-card-time">{record.time}</span>
        <svg className="hs-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <div className="anpr-card-body-wrap">
        <div className="anpr-card-body">
          <div className="anpr-card-body-inner">
            {open && record.imageCount > 0 && (
              <div className="anpr-card-imgs">
                {Array.from({ length: record.imageCount }, (_, i) => {
                  const src = `/api/tcplpr/image/${connId}/${record.id}/${i}`;
                  const label = t.imageN(i + 1);
                  return (
                    <div key={i} className="anpr-img-wrap">
                      <span className="anpr-cell-label">{label}</span>
                      <img className="anpr-card-img" src={src} alt={label} title={t.clickToView}
                        onClick={() => onImgClick({ src, label, record })} />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="anpr-card-grid">
              {BODY_FIELD_KEYS.filter(f => record[f.key] != null && record[f.key] !== '').map(f => (
                <div key={f.key} className={`anpr-cell${f.key === 'guid' ? ' anpr-cell-wide' : ''}`}>
                  <span className="anpr-cell-label">{f.tKey ? t[f.tKey] : f.label}</span>
                  <span className="anpr-cell-value">{record[f.key]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AnprTcpClient() {
  const t = useT();
  const [host,     setHost]     = useState('');
  const [port,     setPort]     = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [connState,   setConnState]   = useState('idle');
  const [connId,      setConnId]      = useState(null);
  const [error,       setError]       = useState('');
  const [allRecords,  setAllRecords]  = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [onLivePage,  setOnLivePage]  = useState(true);
  const [autoScroll,  setAutoScroll]  = useState(true);
  const [imgModal,    setImgModal]    = useState(null);

  const [filters,    setFilters]    = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  const wsRef     = useRef(null);
  const bottomRef = useRef(null);
  const connRef   = useRef(null);
  const seqRef    = useRef(0);

  const totalPages  = Math.max(1, Math.ceil(allRecords.length / PAGE_SIZE));
  const isLivePage  = onLivePage;
  const pageStart   = (currentPage - 1) * PAGE_SIZE;
  const pageRecords = allRecords.slice(pageStart, pageStart + PAGE_SIZE);
  const filtered    = applyFilters(pageRecords, filters);
  const isFiltered  = hasActiveFilter(filters);

  useEffect(() => {
    if (onLivePage) setCurrentPage(totalPages);
  }, [totalPages, onLivePage]);

  useEffect(() => { connRef.current = connId; }, [connId]);

  useEffect(() => {
    if (autoScroll && onLivePage && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allRecords.length, autoScroll, onLivePage]);

  useEffect(() => () => wsRef.current?.close(), []);

  useEffect(() => {
    function onUnload() {
      if (connRef.current) navigator.sendBeacon(`/api/tcplpr/disconnect/${connRef.current}`);
    }
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => {
    function onCacheCleared() {
      setAllRecords([]);
      setCurrentPage(1);
      setOnLivePage(true);
      seqRef.current = 0;
    }
    window.addEventListener('nt-cache-cleared', onCacheCleared);
    return () => window.removeEventListener('nt-cache-cleared', onCacheCleared);
  }, []);

  function setFilter(key, val) { setFilters(f => ({ ...f, [key]: val })); }

  function goToPage(page) {
    const last = Math.max(1, Math.ceil(allRecords.length / PAGE_SIZE));
    const target = Math.max(1, Math.min(page, last));
    setOnLivePage(target >= last);
    setCurrentPage(target);
  }

  async function handleConnect() {
    setError('');
    try {
      const { data } = await axios.post('/api/tcplpr/connect', {
        host: host.trim(), port: Number(port),
      });
      setConnId(data.connId);
      setAllRecords([]);
      setCurrentPage(1);
      setOnLivePage(true);
      seqRef.current = 0;
      setConnState('connected');

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/tcplpr/stream/${data.connId}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'record') {
          seqRef.current++;
          const rec = { ...msg.record, _seq: seqRef.current };
          setAllRecords(prev => [...prev, rec]);
        } else if (msg.type === 'status' && msg.state === 'authenticated') {
          setConnState('authenticated');
        } else if (msg.type === 'auth_failed') {
          setError(msg.message || 'Authentication failed');
        } else if (msg.type === 'disconnected') {
          setConnState('idle'); setConnId(null);
        }
      };
      ws.onclose = () => setConnState(s => s !== 'idle' ? 'idle' : s);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function handleAuth() {
    setError('');
    try {
      await axios.post(`/api/tcplpr/auth/${connId}`, {
        username: username.trim(), password: password.trim(),
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function handleDisconnect() {
    if (!connId) return;
    try { await axios.delete(`/api/tcplpr/disconnect/${connId}`); } catch {}
    wsRef.current?.close();
    setConnState('idle'); setConnId(null);
  }

  function handleClear() {
    setAllRecords([]);
    setCurrentPage(1);
    setOnLivePage(true);
    seqRef.current = 0;
    if (connId) axios.delete(`/api/tcplpr/records/${connId}`).catch(() => {});
  }

  async function saveImage(url, filename) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'lpr.jpg';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {}
  }

  const isIdle      = connState === 'idle';
  const isConnected = connState === 'connected' || connState === 'authenticated';
  const isAuthed    = connState === 'authenticated';

  return (
    <div className="anpr-root">

      {/* ── Config bar ───────────────────────────────────────────────────────── */}
      <div className="hs-config-bar">
        <div className="hs-config-fields">
          <div className="hs-field" style={{ flex: 3 }}>
            <label className="hs-label">{t.tcpCameraHost}</label>
            <input className="hs-input" value={host}
              onChange={e => setHost(e.target.value)}
              disabled={isConnected} placeholder="192.168.1.100" />
          </div>
          <div className="hs-field hs-field-port">
            <label className="hs-label">{t.port}</label>
            <input className="hs-input" value={port}
              onChange={e => setPort(e.target.value.replace(/\D/g, ''))}
              disabled={isConnected} placeholder="5000" />
          </div>
          <div className="hs-field-sep" />
          <div className="hs-field">
            <label className="hs-label">{t.username}</label>
            <input className="hs-input" value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={isAuthed} placeholder="admin" autoComplete="off" />
          </div>
          <div className="hs-field">
            <label className="hs-label">{t.password}</label>
            <input className="hs-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={isAuthed} placeholder="••••••••" autoComplete="off" />
          </div>
        </div>

        <div className="hs-config-actions tcplpr-actions">
          {isIdle && (
            <button className="btn-primary hs-start-btn" onClick={handleConnect}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2 8h12M9 3l5 5-5 5"/>
              </svg>
              {t.connect}
            </button>
          )}
          {connState === 'connected' && (
            <button className="btn-primary hs-start-btn" onClick={handleAuth}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="7" width="10" height="7" rx="1.5"/>
                <path d="M5 7V5a3 3 0 016 0v2"/>
              </svg>
              {t.tcpAuth}
            </button>
          )}
          {isConnected && (
            <button className="btn-danger hs-stop-btn" onClick={handleDisconnect}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <rect x="2" y="2" width="12" height="12" rx="2"/>
              </svg>
              {t.disconnect}
            </button>
          )}
        </div>
      </div>

      {error && <div className="inline-error" style={{ margin: '0 0 4px' }}>{error}</div>}

      {/* ── Status bar ───────────────────────────────────────────────────────── */}
      <div className="hs-status-bar">
        {isConnected && <span className="hs-status-dot" style={isAuthed ? {} : { background: 'var(--yellow)' }} />}
        <span className="hs-status-text">
          {isIdle && t.tcpDisconnected}
          {connState === 'connected' && t.tcpConnectedAuth(host, port)}
          {isAuthed && t.tcpAuthenticated(host, port)}
        </span>
        <div style={{ flex: 1 }} />
        {isConnected && (
          <>
            <span className="hs-req-count">
              {isFiltered
                ? `${filtered.length} / ${pageRecords.length}`
                : t.records(allRecords.length)
              }
            </span>
            <label className="api-opt-check">
              <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
              <span className="api-opt-check-label">{t.autoScroll}</span>
            </label>
          </>
        )}
        {allRecords.length > 0 && (
          <button className="btn-xs danger" onClick={handleClear}>{t.clear}</button>
        )}
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="anpr-filter-bar">
        <button
          className={`anpr-filter-toggle${filterOpen ? ' active' : ''}${isFiltered ? ' has-filter' : ''}`}
          onClick={() => setFilterOpen(v => !v)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5 8h6M8 12h0"/>
          </svg>
          {t.filter}
          {isFiltered && <span className="anpr-filter-dot" />}
        </button>
        {isFiltered && (
          <button className="btn-xs" onClick={() => setFilters(EMPTY_FILTERS)}>{t.clearFilters}</button>
        )}
      </div>

      {/* ── Filter panel ─────────────────────────────────────────────────────── */}
      <div className={`anpr-filter-panel-wrap${filterOpen ? ' open' : ''}`}>
        <div className="anpr-filter-panel">
          <div className="anpr-filter-panel-inner">
            <div className="anpr-filter-grid">
              {FILTER_FIELD_KEYS.map(f => (
                <div key={f.key} className="anpr-filter-cell">
                  <label className="anpr-cell-label">{t[f.tKey]}</label>
                  <input className="anpr-filter-input" value={filters[f.key]}
                    onChange={e => setFilter(f.key, e.target.value)} placeholder={t.contains} />
                </div>
              ))}
              <div className="anpr-filter-cell">
                <label className="anpr-cell-label">{t.timeStart}</label>
                <input className="anpr-filter-input" value={filters.timeStart}
                  onChange={e => setFilter('timeStart', e.target.value)} placeholder="2024/1/1 00:00:00" />
              </div>
              <div className="anpr-filter-cell">
                <label className="anpr-cell-label">{t.timeEnd}</label>
                <input className="anpr-filter-input" value={filters.timeEnd}
                  onChange={e => setFilter('timeEnd', e.target.value)} placeholder="2024/12/31 23:59:59" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Record log ───────────────────────────────────────────────────────── */}
      <div className="hs-log anpr-log">
        {allRecords.length === 0 && isIdle && (
          <div className="hs-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
              <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3"/>
            </svg>
            <p>{t.tcpEmpty}</p>
          </div>
        )}
        {allRecords.length === 0 && connState === 'connected' && (
          <div className="hs-empty">
            <span className="hs-pulse-ring" style={{ borderColor: 'var(--yellow)' }} />
            <p>{t.tcpWaitAuth}</p>
          </div>
        )}
        {allRecords.length === 0 && isAuthed && (
          <div className="hs-empty">
            <span className="hs-pulse-ring" />
            <p>{t.tcpWaitRecords}</p>
          </div>
        )}
        {isFiltered && filtered.length === 0 && pageRecords.length > 0 && (
          <div className="hs-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <p>{t.noRecordsMatch}</p>
          </div>
        )}
        {filtered.map(r => (
          <TcpLprCard key={r.id} record={r} connId={connId} onImgClick={setImgModal} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Floating pagination ───────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="anpr-pagination-bar">
          <div className="anpr-pagination">
            <button className="anpr-page-btn" disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7.5 2L3 6l4.5 4"/></svg>
              {t.prev}
            </button>
            <span className="anpr-page-info">
              {isLivePage && <span className="anpr-live-dot" />}
              {currentPage} / {totalPages}
            </span>
            <button className="anpr-page-btn" disabled={isLivePage}
              onClick={() => goToPage(currentPage + 1)}>
              {t.next}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4.5 2L9 6l-4.5 4"/></svg>
            </button>
            {!isLivePage && (
              <button className="anpr-page-btn anpr-page-latest" onClick={() => goToPage(totalPages)}>
                {t.latest}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 6h7M6 3l4 3-4 3"/></svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Image modal ──────────────────────────────────────────────────────── */}
      {imgModal && (
        <div className="anpr-modal-backdrop" onClick={() => setImgModal(null)}>
          <div className="anpr-modal" onClick={e => e.stopPropagation()}>
            <div className="anpr-modal-hdr">
              <span className="anpr-modal-title">{imgModal.label}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-primary" style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => {
                    const r = imgModal.record;
                    const name = [r.guid, r.plate, imgModal.label].filter(Boolean).join('_') + '.jpg';
                    saveImage(imgModal.src, name);
                  }}>
                  {t.save}
                </button>
                <button className="anpr-modal-close" onClick={() => setImgModal(null)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M2 2l10 10M12 2L2 12"/>
                  </svg>
                </button>
              </div>
            </div>
            <div className="anpr-modal-body">
              <img className="anpr-modal-img" src={imgModal.src} alt={imgModal.label} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
