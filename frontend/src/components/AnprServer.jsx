import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const PAGE_SIZE = 50;

const BODY_FIELDS = [
  { key: 'plate',            label: 'Plate' },
  { key: 'type',             label: 'Type' },
  { key: 'plateColor',       label: 'Plate Color' },
  { key: 'vehicleType',      label: 'Vehicle Type' },
  { key: 'vehicleColor',     label: 'Vehicle Color' },
  { key: 'vehicleBrand',     label: 'Vehicle Brand' },
  { key: 'confidence',       label: 'Confidence' },
  { key: 'speed',            label: 'Speed' },
  { key: 'direction',        label: 'Direction' },
  { key: 'detectionRegion',  label: 'Detection Region' },
  { key: 'region',           label: 'Region' },
  { key: 'device',           label: 'Device' },
  { key: 'time',             label: 'Time' },
  { key: 'timeMsec',         label: 'Time mSec' },
  { key: 'resolutionWidth',  label: 'Res Width' },
  { key: 'resolutionHeight', label: 'Res Height' },
  { key: 'coordinateX1',    label: 'X1' },
  { key: 'coordinateY1',    label: 'Y1' },
  { key: 'coordinateX2',    label: 'X2' },
  { key: 'coordinateY2',    label: 'Y2' },
];

const FILTER_FIELDS = [
  { key: 'plate',           label: 'Plate' },
  { key: 'type',            label: 'Type' },
  { key: 'plateColor',      label: 'Plate Color' },
  { key: 'vehicleType',     label: 'Vehicle Type' },
  { key: 'vehicleColor',    label: 'Vehicle Color' },
  { key: 'vehicleBrand',    label: 'Vehicle Brand' },
  { key: 'confidence',      label: 'Confidence' },
  { key: 'speed',           label: 'Speed' },
  { key: 'direction',       label: 'Direction' },
  { key: 'detectionRegion', label: 'Detection Region' },
  { key: 'region',          label: 'Region' },
  { key: 'device',          label: 'Device' },
];

const EMPTY_FILTERS = {
  plate: '', type: '', plateColor: '', vehicleType: '', vehicleColor: '',
  vehicleBrand: '', confidence: '', speed: '', direction: '',
  detectionRegion: '', region: '', device: '',
  timeStart: '', timeEnd: '',
};

function hasActiveFilter(f) {
  return Object.values(f).some(v => v.trim() !== '');
}

function applyFilters(records, filters) {
  return records.filter(r => {
    for (const { key } of FILTER_FIELDS) {
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
function AnprCard({ record, instanceId, onImgClick }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`anpr-card${open ? ' open' : ''}`}>
      <button className="anpr-card-hdr" onClick={() => setOpen(o => !o)}>
        <span className="anpr-card-idx">#{record._seq}</span>
        <span className="anpr-card-plate">{record.plate || '—'}</span>
        {record.vehicleType  && <span className="anpr-card-tag">{record.vehicleType}</span>}
        {record.vehicleColor && <span className="anpr-card-tag">{record.vehicleColor}</span>}
        {record.plateColor   && <span className="anpr-card-tag anpr-tag-dim">{record.plateColor}</span>}
        <span className="anpr-card-spacer" />
        {record.device && <span className="anpr-card-device">{record.device}</span>}
        {record.time   && <span className="anpr-card-time">{record.time}</span>}
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
                  const src = `/api/anpr/image/${instanceId}/${record.id}/${i}`;
                  const label = i === 0 ? 'Plate Image' : 'Full Image';
                  return (
                    <div key={i} className="anpr-img-wrap">
                      <span className="anpr-cell-label">{label}</span>
                      <img className="anpr-card-img" src={src} alt={label} title="Click to view / save"
                        onClick={() => onImgClick({ src, label, record })} />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="anpr-card-grid">
              {BODY_FIELDS.filter(f => record[f.key] != null).map(f => (
                <div key={f.key} className="anpr-cell">
                  <span className="anpr-cell-label">{f.label}</span>
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
export default function AnprServer() {
  const [port,     setPort]     = useState('8080');
  const [path,     setPath]     = useState('/httpServer');
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');

  const [running,     setRunning]     = useState(false);
  const [instanceId,  setInstanceId]  = useState(null);
  const [serverInfo,  setServerInfo]  = useState(null);
  const [error,       setError]       = useState('');
  // allRecords: accumulates all records in this session, each with stable _seq
  const [allRecords,  setAllRecords]  = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [onLivePage,  setOnLivePage]  = useState(true);
  const [autoScroll,  setAutoScroll]  = useState(true);
  const [imgModal,    setImgModal]    = useState(null);

  const [filters,    setFilters]    = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  const wsRef       = useRef(null);
  const bottomRef   = useRef(null);
  const instanceRef = useRef(null);
  const seqRef      = useRef(0); // monotonically increasing across this session

  const totalPages  = Math.max(1, Math.ceil(allRecords.length / PAGE_SIZE));
  const isLivePage  = onLivePage;
  const pageStart   = (currentPage - 1) * PAGE_SIZE;
  const pageRecords = allRecords.slice(pageStart, pageStart + PAGE_SIZE);
  const filtered    = applyFilters(pageRecords, filters);
  const isFiltered  = hasActiveFilter(filters);

  // Auto-advance to last page when on live page and new record arrives
  useEffect(() => {
    if (onLivePage) setCurrentPage(totalPages);
  }, [totalPages, onLivePage]);

  useEffect(() => { instanceRef.current = instanceId; }, [instanceId]);

  useEffect(() => {
    if (autoScroll && onLivePage && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allRecords.length, autoScroll, onLivePage]);

  useEffect(() => () => wsRef.current?.close(), []);

  useEffect(() => {
    function onUnload() {
      if (instanceRef.current) navigator.sendBeacon(`/api/anpr/stop/${instanceRef.current}`);
    }
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  function setFilter(key, val) { setFilters(f => ({ ...f, [key]: val })); }

  function goToPage(page) {
    const last = Math.max(1, Math.ceil(allRecords.length / PAGE_SIZE));
    const target = Math.max(1, Math.min(page, last));
    setOnLivePage(target >= last);
    setCurrentPage(target);
  }

  async function handleStart() {
    setError('');
    try {
      const { data } = await axios.post('/api/anpr/start', {
        port: Number(port), path,
        authUser: authUser.trim(), authPass: authPass.trim(),
      });
      setInstanceId(data.instanceId);
      setServerInfo({ port: data.port, path: data.path });
      setAllRecords([]);
      setCurrentPage(1);
      setOnLivePage(true);
      seqRef.current = 0;
      setRunning(true);

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/anpr/stream/${data.instanceId}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'record') {
          seqRef.current++;
          const rec = { ...msg.record, _seq: seqRef.current };
          setAllRecords(prev => [...prev, rec]);
        } else if (msg.type === 'stopped') {
          setRunning(false);
        }
      };
      ws.onclose = () => setRunning(false);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  }

  async function handleStop() {
    if (!instanceId) return;
    try { await axios.delete(`/api/anpr/stop/${instanceId}`); } catch {}
    wsRef.current?.close();
    setRunning(false); setInstanceId(null); setServerInfo(null);
  }

  function handleClear() {
    setAllRecords([]);
    setCurrentPage(1);
    setOnLivePage(true);
    seqRef.current = 0;
    if (instanceId) axios.delete(`/api/anpr/records/${instanceId}`).catch(() => {});
  }

  async function saveImage(url, filename) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'anpr.jpg';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {}
  }

  return (
    <div className="anpr-root">

      {/* ── Config bar ───────────────────────────────────────────────────────── */}
      <div className="hs-config-bar">
        <div className="hs-config-fields">
          <div className="hs-field hs-field-port">
            <label className="hs-label">Port</label>
            <input className="hs-input" value={port}
              onChange={e => setPort(e.target.value.replace(/\D/g, ''))}
              disabled={running} placeholder="8080" />
          </div>
          <div className="hs-field" style={{ flex: 2 }}>
            <label className="hs-label">Context path</label>
            <input className="hs-input" value={path}
              onChange={e => setPath(e.target.value)}
              disabled={running} placeholder="/httpServer" />
          </div>
          <div className="hs-field-sep" />
          <div className="hs-field">
            <label className="hs-label">Auth user <span className="hs-optional">(optional)</span></label>
            <input className="hs-input" value={authUser}
              onChange={e => setAuthUser(e.target.value)}
              disabled={running} placeholder="username" autoComplete="off" />
          </div>
          <div className="hs-field">
            <label className="hs-label">Auth password</label>
            <input className="hs-input" type="password" value={authPass}
              onChange={e => setAuthPass(e.target.value)}
              disabled={running} placeholder="••••••••" autoComplete="off" />
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

      {error && <div className="inline-error" style={{ margin: '0 0 4px' }}>{error}</div>}

      {/* ── Status bar ───────────────────────────────────────────────────────── */}
      {running && serverInfo && (
        <div className="hs-status-bar">
          <span className="hs-status-dot" />
          <span className="hs-status-text">
            Listening on port <strong>{serverInfo.port}</strong> → <code>{serverInfo.path}</code>
            {authUser.trim() && <span className="hs-auth-badge">Basic Auth</span>}
          </span>
          <div style={{ flex: 1 }} />
          <span className="hs-req-count">
            {isFiltered
              ? `${filtered.length} / ${pageRecords.length}`
              : allRecords.length
            }
            {' '}record{allRecords.length !== 1 ? 's' : ''}
          </span>
          <label className="api-opt-check">
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
            <span className="api-opt-check-label">Auto-scroll</span>
          </label>
          {allRecords.length > 0 && (
            <button className="btn-xs danger" onClick={handleClear}>Clear</button>
          )}
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="anpr-filter-bar">
        <button
          className={`anpr-filter-toggle${filterOpen ? ' active' : ''}${isFiltered ? ' has-filter' : ''}`}
          onClick={() => setFilterOpen(v => !v)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5 8h6M8 12h0"/>
          </svg>
          Filter
          {isFiltered && <span className="anpr-filter-dot" />}
        </button>
        {isFiltered && (
          <button className="btn-xs" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
        )}
      </div>

      {/* ── Filter panel ─────────────────────────────────────────────────────── */}
      <div className={`anpr-filter-panel-wrap${filterOpen ? ' open' : ''}`}>
        <div className="anpr-filter-panel">
          <div className="anpr-filter-panel-inner">
            <div className="anpr-filter-grid">
              {FILTER_FIELDS.map(f => (
                <div key={f.key} className="anpr-filter-cell">
                  <label className="anpr-cell-label">{f.label}</label>
                  <input className="anpr-filter-input" value={filters[f.key]}
                    onChange={e => setFilter(f.key, e.target.value)} placeholder="contains…" />
                </div>
              ))}
              <div className="anpr-filter-cell">
                <label className="anpr-cell-label">Time — Start</label>
                <input className="anpr-filter-input" value={filters.timeStart}
                  onChange={e => setFilter('timeStart', e.target.value)} placeholder="2024-01-01 00:00:00" />
              </div>
              <div className="anpr-filter-cell">
                <label className="anpr-cell-label">Time — End</label>
                <input className="anpr-filter-input" value={filters.timeEnd}
                  onChange={e => setFilter('timeEnd', e.target.value)} placeholder="2024-12-31 23:59:59" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Record log ───────────────────────────────────────────────────────── */}
      <div className="hs-log anpr-log">
        {allRecords.length === 0 && !running && (
          <div className="hs-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
              <rect x="3" y="6" width="18" height="13" rx="2"/>
              <path d="M3 10h18M8 6V4M16 6V4"/>
            </svg>
            <p>Configure and start the ANPR server to receive records</p>
          </div>
        )}
        {allRecords.length === 0 && running && (
          <div className="hs-empty">
            <span className="hs-pulse-ring" />
            <p>Waiting for ANPR records…</p>
          </div>
        )}
        {isFiltered && filtered.length === 0 && pageRecords.length > 0 && (
          <div className="hs-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.25">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <p>No records match the current filters</p>
          </div>
        )}
        {filtered.map(r => (
          <AnprCard key={r.id} record={r} instanceId={instanceId} onImgClick={setImgModal} />
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
              Prev
            </button>
            <span className="anpr-page-info">
              {isLivePage && <span className="anpr-live-dot" />}
              {currentPage} / {totalPages}
            </span>
            <button className="anpr-page-btn" disabled={isLivePage}
              onClick={() => goToPage(currentPage + 1)}>
              Next
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4.5 2L9 6l-4.5 4"/></svg>
            </button>
            {!isLivePage && (
              <button className="anpr-page-btn anpr-page-latest" onClick={() => goToPage(totalPages)}>
                Latest
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
                    const name = [r.device, r.time, r.plate, imgModal.label].filter(Boolean).join('_') + '.jpg';
                    saveImage(imgModal.src, name);
                  }}>
                  Save
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
