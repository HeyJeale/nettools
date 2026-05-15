import React, { useState, useEffect } from 'react';
import SSHWorkspace from './components/SSHWorkspace.jsx';
import PcapAnalyzer from './components/PcapAnalyzer.jsx';
import ApiTester from './components/ApiTester.jsx';
import HttpServer from './components/HttpServer.jsx';
import AnprServer from './components/AnprServer.jsx';
import AnprTcpClient from './components/AnprTcpClient.jsx';
import Settings from './components/Settings.jsx';
import { LANGS, LangContext, useT } from './i18n.js';

const NAV_IDS = ['ssh', 'pcap', 'api', 'httpserver', 'anpr', 'tcplpr', 'settings'];

const NAV_ICONS = {
  ssh: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="14" height="10" rx="2"/>
      <path d="M4 7l2 2-2 2M8 11h4"/>
    </svg>
  ),
  pcap: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8h2l2-5 2 10 2-7 2 4 1-2h3"/>
    </svg>
  ),
  api: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h12M2 8h8M2 12h5"/><circle cx="13" cy="11" r="2.5"/><path d="M14.8 12.8l1.2 1.2"/>
    </svg>
  ),
  httpserver: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="5" rx="1.5"/>
      <rect x="1" y="9" width="14" height="5" rx="1.5"/>
      <circle cx="4" cy="4.5" r="0.8" fill="currentColor" stroke="none"/>
      <circle cx="4" cy="11.5" r="0.8" fill="currentColor" stroke="none"/>
    </svg>
  ),
  anpr: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="14" height="8" rx="1.5"/>
      <path d="M4 7h8M4 9.5h5"/>
      <circle cx="11.5" cy="9.5" r="1" fill="currentColor" stroke="none"/>
    </svg>
  ),
  tcplpr: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="14" height="8" rx="1.5"/>
      <path d="M4 7h5M4 9.5h3"/>
      <path d="M11 6l3 2-3 2"/>
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2"/>
      <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>
    </svg>
  ),
};

const NAV_LABEL_KEYS = {
  ssh:        'navSsh',
  pcap:       'navPcap',
  api:        'navApi',
  httpserver: 'navHttp',
  anpr:       'navAnpr',
  tcplpr:     'navTcpLpr',
  settings:   'navSettings',
};

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  );
}

function glassMove(e) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--sx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--sy', `${e.clientY - r.top}px`);
}

// Inner component so useT() can read LangContext provided by App
function AppInner({ lang, setLang, theme, setTheme }) {
  const t = useT();
  const [view, setView] = useState('ssh');
  const [sessionId, setSessionId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connInfo, setConnInfo] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    function move(e) {
      document.documentElement.style.setProperty('--mx', `${e.clientX}px`);
      document.documentElement.style.setProperty('--my', `${e.clientY}px`);
    }
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  function cycleTheme() {
    setTheme(th => th === 'auto' ? 'dark' : th === 'dark' ? 'light' : 'auto');
  }

  const themeIcon = theme === 'light' ? <SunIcon /> : theme === 'dark' ? <MoonIcon /> : <span className="theme-auto">A</span>;
  const themeText = theme === 'auto' ? t.themeAuto : theme === 'dark' ? t.themeDark : t.themeLight;

  return (
    <div className="app">
      <div className="mouse-spotlight" aria-hidden="true" />
      <div className="bg-orb bg-orb-1" aria-hidden="true" />
      <div className="bg-orb bg-orb-2" aria-hidden="true" />
      <div className="bg-orb bg-orb-3" aria-hidden="true" />

      <aside className={`sidebar${sidebarCollapsed ? ' sidebar-collapsed' : ''}`} onMouseMove={glassMove}>
        <div className="sidebar-specular" aria-hidden="true" />
        <div className="sidebar-inner">
          <div className="sidebar-brand">
            <div className="brand-logo">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" rx="2.5" fill="currentColor"/>
                <rect x="11" y="2" width="7" height="7" rx="2.5" fill="currentColor" opacity="0.6"/>
                <rect x="2" y="11" width="7" height="7" rx="2.5" fill="currentColor" opacity="0.6"/>
                <rect x="11" y="11" width="7" height="7" rx="2.5" fill="currentColor" opacity="0.3"/>
              </svg>
            </div>
            {!sidebarCollapsed && <span className="sidebar-brand-text">NetTools</span>}
          </div>

          <nav className="sidebar-nav">
            {NAV_IDS.map((id) => (
              <button
                key={id}
                className={`nav-item${view === id ? ' active' : ''}`}
                onClick={() => setView(id)}
                title={sidebarCollapsed ? t[NAV_LABEL_KEYS[id]] : ''}
              >
                <span className="nav-icon">{NAV_ICONS[id]}</span>
                {!sidebarCollapsed && <span className="nav-label">{t[NAV_LABEL_KEYS[id]]}</span>}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button className="theme-btn" onClick={cycleTheme} title={t.themeLabel + themeText}>
              {themeIcon}
              {!sidebarCollapsed && <span>{themeText}</span>}
            </button>

            {!sidebarCollapsed && (
              <div className={`conn-status ${connected ? 'connected' : 'disconnected'}`}>
                <span className="status-dot" />
                <span className="conn-text">
                  {connected && connInfo ? `${connInfo.username}@${connInfo.host}` : t.notConnected}
                </span>
              </div>
            )}
            {sidebarCollapsed && (
              <div className={`conn-status conn-status-collapsed ${connected ? 'connected' : 'disconnected'}`}>
                <span className="status-dot" />
              </div>
            )}
          </div>
        </div>

        <button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed(v => !v)}
          title={sidebarCollapsed ? t.expand : t.collapse}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {sidebarCollapsed ? <path d="M4 2l4 4-4 4"/> : <path d="M8 2L4 6l4 4"/>}
          </svg>
        </button>
      </aside>

      <main className={`main-content${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <div style={{ display: view === 'ssh' ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <SSHWorkspace
            sessionId={sessionId} setSessionId={setSessionId}
            connected={connected} setConnected={setConnected}
            connInfo={connInfo} setConnInfo={setConnInfo}
          />
        </div>
        <div style={{ display: view === 'pcap' ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <PcapAnalyzer />
        </div>
        {view === 'api' && <ApiTester />}
        <div style={{ display: view === 'httpserver' ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <HttpServer />
        </div>
        <div style={{ display: view === 'anpr' ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <AnprServer />
        </div>
        <div style={{ display: view === 'tcplpr' ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <AnprTcpClient />
        </div>
        {view === 'settings' && <Settings theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} />}
      </main>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('nt-theme') || 'dark');
  const [lang,  setLang]  = useState(() => localStorage.getItem('nt-lang')  || 'en');

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function apply() {
      const isDark = theme === 'dark' || (theme === 'auto' && mq.matches);
      root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }
    apply();
    localStorage.setItem('nt-theme', theme);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('nt-lang', lang);
  }, [lang]);

  useEffect(() => {
    function onUnload() {
      if (localStorage.getItem('nt-auto-clean') !== 'false') {
        navigator.sendBeacon('/api/cache/clear');
      }
    }
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return (
    <LangContext.Provider value={lang}>
      <AppInner lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} />
    </LangContext.Provider>
  );
}
