import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LANGS, useT } from '../i18n.js';

function fmtBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

const THEME_OPTIONS = [
  {
    id: 'dark',
    labelKey: 'themeDark',
    preview: (
      <div style={{ width: '100%', height: '100%', background: '#0d1117', display: 'flex', gap: 5, padding: 7 }}>
        <div style={{ width: 22, background: '#161b22', borderRadius: 3, flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ height: 7, background: '#30363d', borderRadius: 2 }} />
          <div style={{ height: 7, background: '#21262d', borderRadius: 2, width: '70%' }} />
          <div style={{ height: 7, background: '#21262d', borderRadius: 2, width: '50%' }} />
        </div>
      </div>
    ),
  },
  {
    id: 'light',
    labelKey: 'themeLight',
    preview: (
      <div style={{ width: '100%', height: '100%', background: '#f6f8fa', display: 'flex', gap: 5, padding: 7 }}>
        <div style={{ width: 22, background: '#eaeef2', borderRadius: 3, flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ height: 7, background: '#d0d7de', borderRadius: 2 }} />
          <div style={{ height: 7, background: '#e4e9ef', borderRadius: 2, width: '70%' }} />
          <div style={{ height: 7, background: '#e4e9ef', borderRadius: 2, width: '50%' }} />
        </div>
      </div>
    ),
  },
  {
    id: 'auto',
    labelKey: 'themeAuto',
    preview: (
      <div style={{ width: '100%', height: '100%', display: 'flex' }}>
        <div style={{ width: '50%', background: '#0d1117', display: 'flex', gap: 3, padding: '7px 3px 7px 7px', overflow: 'hidden' }}>
          <div style={{ width: 12, background: '#161b22', borderRadius: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ height: 6, background: '#30363d', borderRadius: 2 }} />
            <div style={{ height: 6, background: '#21262d', borderRadius: 2 }} />
            <div style={{ height: 6, background: '#21262d', borderRadius: 2, width: '60%' }} />
          </div>
        </div>
        <div style={{ width: '50%', background: '#f6f8fa', display: 'flex', gap: 3, padding: '7px 7px 7px 3px', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ height: 6, background: '#d0d7de', borderRadius: 2 }} />
            <div style={{ height: 6, background: '#e4e9ef', borderRadius: 2 }} />
            <div style={{ height: 6, background: '#e4e9ef', borderRadius: 2, width: '60%' }} />
          </div>
          <div style={{ width: 12, background: '#eaeef2', borderRadius: 2, flexShrink: 0 }} />
        </div>
      </div>
    ),
  },
];

export default function Settings({ theme, setTheme, lang, setLang }) {
  const t = useT();
  const [cacheInfo,   setCacheInfo]   = useState(null);
  const [clearing,    setClearing]    = useState(false);
  const [clearResult, setClearResult] = useState(null);
  const [autoClean,   setAutoClean]   = useState(
    () => localStorage.getItem('nt-auto-clean') !== 'false',
  );

  useEffect(() => {
    axios.get('/api/cache/info').then(r => setCacheInfo(r.data)).catch(() => {});
  }, []);

  function handleAutoCleanChange(val) {
    setAutoClean(val);
    localStorage.setItem('nt-auto-clean', val ? 'true' : 'false');
  }

  async function handleClear() {
    setClearing(true);
    setClearResult(null);
    try {
      const { data } = await axios.post('/api/cache/clear');
      setClearResult({ ok: true, freed: data.freed, count: data.count });
      setCacheInfo({ bytes: 0, count: 0 });
    } catch (err) {
      setClearResult({ ok: false, error: err.response?.data?.error || err.message });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="settings-root">

      {/* ── Language ───────────────────────────────────────────────────────────── */}
      <div className="settings-card">
        <div className="settings-card-title">{t.settingsLang}</div>
        <div className="lang-selector">
          {Object.entries(LANGS).map(([id, { label }]) => (
            <button
              key={id}
              className={`lang-btn${lang === id ? ' selected' : ''}`}
              onClick={() => setLang(id)}
            >
              {label}
              {lang === id && (
                <span className="lang-btn-check">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1.5 5l2.5 2.5 4.5-4.5"/>
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Color mode ─────────────────────────────────────────────────────────── */}
      <div className="settings-card">
        <div className="settings-card-title">{t.settingsColorMode}</div>
        <div className="theme-cards">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.id}
              className={`theme-card${theme === opt.id ? ' selected' : ''}`}
              onClick={() => setTheme(opt.id)}
            >
              <div className="theme-preview">{opt.preview}</div>
              <span className="theme-card-label">{t[opt.labelKey]}</span>
              {theme === opt.id && (
                <span className="theme-card-check">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1.5 5l2.5 2.5 4.5-4.5"/>
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Cache management ───────────────────────────────────────────────────── */}
      <div className="settings-card">
        <div className="settings-card-title">{t.settingsCache}</div>
        <p className="settings-card-desc">{t.settingsCacheDesc}</p>
        <div className="settings-cache-row">
          <span className="settings-cache-size">
            {cacheInfo == null
              ? t.settingsCacheLoading
              : `${fmtBytes(cacheInfo.bytes)} · ${cacheInfo.count} ${cacheInfo.count !== 1 ? 'files' : 'file'}`
            }
          </span>
          <button
            className="btn-primary"
            style={{ fontSize: 13 }}
            onClick={handleClear}
            disabled={clearing || (cacheInfo != null && cacheInfo.count === 0)}
          >
            {clearing ? t.settingsClearing : t.settingsClearCache}
          </button>
        </div>
        {clearResult && (
          <div className={`settings-clear-result ${clearResult.ok ? 'ok' : 'err'}`}>
            {clearResult.ok
              ? t.settingsClearedResult(clearResult.count, fmtBytes(clearResult.freed))
              : t.settingsFailed(clearResult.error)
            }
          </div>
        )}
      </div>

      {/* ── Auto-clean on exit ─────────────────────────────────────────────────── */}
      <div className="settings-card">
        <div className="settings-card-title">{t.settingsAutoClean}</div>
        <div className="settings-toggle-row">
          <div className="settings-toggle-text">
            <div className="settings-toggle-label">{t.settingsAutoCleanLabel}</div>
            <div className="settings-toggle-sublabel">{t.settingsAutoCleanSub}</div>
          </div>
          <button
            role="switch"
            aria-checked={autoClean}
            className={`settings-toggle${autoClean ? ' on' : ''}`}
            onClick={() => handleAutoCleanChange(!autoClean)}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>
      </div>

    </div>
  );
}
