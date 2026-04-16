import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useT } from '../i18n.js';

const PAGE_SIZE = 50;

// Field keys for body display and filter — labels resolved via t.* at render time
const BODY_FIELD_KEYS = [
  { key: 'plate',            tKey: 'plate' },
  { key: 'type',             tKey: 'type' },
  { key: 'plateColor',       tKey: 'plateColor' },
  { key: 'vehicleType',      tKey: 'vehicleType' },
  { key: 'vehicleColor',     tKey: 'vehicleColor' },
  { key: 'vehicleBrand',     tKey: 'vehicleBrand' },
  { key: 'confidence',       tKey: 'confidence' },
  { key: 'speed',            tKey: 'speed' },
  { key: 'direction',        tKey: 'direction' },
  { key: 'detectionRegion',  tKey: 'detectionRegion' },
  { key: 'region',           tKey: 'region' },
  { key: 'device',           tKey: 'device' },
  { key: 'time',             tKey: 'time' },
  { key: 'timeMsec',         tKey: 'timeMsec' },
  { key: 'resolutionWidth',  tKey: 'resWidth' },
  { key: 'resolutionHeight', tKey: 'resHeight' },
  { key: 'coordinateX1',    tKey: null, label: 'X1' },
  { key: 'coordinateY1',    tKey: null, label: 'Y1' },
  { key: 'coordinateX2',    tKey: null, label: 'X2' },
  { key: 'coordinateY2',    tKey: null, label: 'Y2' },
];

const FILTER_FIELD_KEYS = [
  { key: 'plate',           tKey: 'plate' },
  { key: 'type',            tKey: 'type' },
  { key: 'plateColor',      tKey: 'plateColor' },
  { key: 'vehicleType',     tKey: 'vehicleType' },
  { key: 'vehicleColor',    tKey: 'vehicleColor' },
  { key: 'vehicleBrand',    tKey: 'vehicleBrand' },
  { key: 'confidence',      tKey: 'confidence' },
  { key: 'speed',           tKey: 'speed' },
  { key: 'direction',       tKey: 'direction' },
  { key: 'detectionRegion', tKey: 'detectionRegion' },
  { key: 'region',          tKey: 'region' },
  { key: 'device',          tKey: 'device' },
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
function AnprCard({ record, instanceId, onImgClick }) {
  const t = useT();
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
                  const label = i === 0 ? t.plateImage : t.fullImage;
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
              {BODY_FIELD_KEYS.filter(f => record[f.key] != null).map(f => (
                <div key={f.key} className="anpr-cell">
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
export default function AnprServer() {
  const t = useT();
  const [port,     setPort]     = useState('8080');
  const [path,     setPath]     = useState('/httpServer');
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');

  const [running,     setRunning]     = useState(false);
  const [instanceId,  setInstanceId]  = useState(null);
  const [serverInfo,  setServerInfo]  = useState(null);
  const [error,       setError]       = useState('');
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
  const seqRef      = useRef(0);

  const totalPages  = Math.max(1, Math.ceil(allRecords.length / PAGE_SIZE));
  const isLivePage  = onLivePage;
  const pageStart   = (currentPage - 1) * PAGE_SIZE;
  const pageRecords = allRecords.slice(pageStart, pageStart + PAGE_SIZE);
  const filtered    = applyFilters(pageRecords, filters);
  const isFiltered  = hasActiveFilter(filters);

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
            <label className="hs-label">{t.port}</label>
            <input className="hs-input" value={port}
              onChange={e => setPort(e.target.value.replace(/\D/g, ''))}
              disabled={running} placeholder="8080" />
          </div>
          <div className="hs-field" style={{ flex: 2 }}>
            <label className="hs-label">{t.anprContextPath}</label>
            <input className="hs-input" value={path}
              onChange={e => setPath(e.target.value)}
              disabled={running} placeholder="/httpServer" />
          </div>
          <div className="hs-field-sep" />
          <div className="hs-field">
            <label className="hs-label">{t.authUser} <span className="hs-optional">{t.authOptional}</span></label>
            <input className="hs-input" value={authUser}
              onChange={e => setAuthUser(e.target.value)}
              disabled={running} placeholder="username" autoComplete="off" />
          </div>
          <div className="hs-field">
            <label className="hs-label">{t.authPassword}</label>
            <input className="hs-input" type="password" value={authPass}
              onChange={e => setAuthPass(e.target.value)}
              disabled={running} placeholder="••••••••" autoComplete="off" />
          </div>
        </div>
        <div className="hs-config-actions">
          {!running ? (
            <button className="btn-primary hs-start-btn" onClick={handleStart}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2.5l10 5.5-10 5.5V2.5z"/></svg>
              {t.start}
            </button>
          ) : (
            <button className="btn-danger hs-stop-btn" onClick={handleStop}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>
              {t.stop}
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
            {t.anprListening(serverInfo.port, serverInfo.path)}
            {authUser.trim() && <span className="hs-auth-badge">{t.basicAuth}</span>}
          </span>
          <div style={{ flex: 1 }} />
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
          {allRecords.length > 0 && (
            <button className="btn-xs danger" onClick={handleClear}>{t.clear}</button>
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
                  onChange={e => setFilter('timeStart', e.target.value)} placeholder="2024-01-01 00:00:00" />
              </div>
              <div className="anpr-filter-cell">
                <label className="anpr-cell-label">{t.timeEnd}</label>
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
            <p>{t.anprEmpty}</p>
          </div>
        )}
        {allRecords.length === 0 && running && (
          <div className="hs-empty">
            <span className="hs-pulse-ring" />
            <p>{t.anprWaiting}</p>
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
                    const name = [r.device, r.time, r.plate, imgModal.label].filter(Boolean).join('_') + '.jpg';
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
