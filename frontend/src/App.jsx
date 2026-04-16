import React, { useState, useEffect, useRef } from 'react';
import SSHWorkspace from './components/SSHWorkspace.jsx';
import PcapAnalyzer from './components/PcapAnalyzer.jsx';
import ApiTester from './components/ApiTester.jsx';
import HttpServer from './components/HttpServer.jsx';
import AnprServer from './components/AnprServer.jsx';
import AnprTcpClient from './components/AnprTcpClient.jsx';
import Settings from './components/Settings.jsx';

const NAV = [
  {
    id: 'ssh',
    label: 'SSH & Files',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="14" height="10" rx="2"/>
        <path d="M4 7l2 2-2 2M8 11h4"/>
      </svg>
    ),
  },
  {
    id: 'pcap',
    label: 'PCAP Analyzer',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 8h2l2-5 2 10 2-7 2 4 1-2h3"/>
      </svg>
    ),
  },
  {
    id: 'api',
    label: 'API Tester',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4h12M2 8h8M2 12h5"/><circle cx="13" cy="11" r="2.5"/><path d="M14.8 12.8l1.2 1.2"/>
      </svg>
    ),
  },
  {
    id: 'httpserver',
    label: 'HTTP Server',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="2" width="14" height="5" rx="1.5"/>
        <rect x="1" y="9" width="14" height="5" rx="1.5"/>
        <circle cx="4" cy="4.5" r="0.8" fill="currentColor" stroke="none"/>
        <circle cx="4" cy="11.5" r="0.8" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    id: 'anpr',
    label: 'ANPR Server',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="14" height="8" rx="1.5"/>
        <path d="M4 7h8M4 9.5h5"/>
        <circle cx="11.5" cy="9.5" r="1" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    id: 'tcplpr',
    label: 'ANPR TCP Client',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="14" height="8" rx="1.5"/>
        <path d="M4 7h5M4 9.5h3"/>
        <path d="M11 6l3 2-3 2"/>
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2.2"/>
        <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>
      </svg>
    ),
  },
];

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

export default function App() {
  const [view, setView] = useState('ssh');
  const [sessionId, setSessionId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connInfo, setConnInfo] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('nt-theme') || 'dark');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Track loaded pcap file so we can prompt before navigating away from large files
  const [pcapFileInfo, setPcapFileInfo] = useState({ pcapId: null, fileSize: 0 });
  const [pcapKey, setPcapKey] = useState(0);

  /* Global mouse → CSS vars for spotlight */
  useEffect(() => {
    function move(e) {
      document.documentElement.style.setProperty('--mx', `${e.clientX}px`);
      document.documentElement.style.setProperty('--my', `${e.clientY}px`);
    }
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  /* Theme */
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

  /* Auto-clean cache on tab close / refresh */
  useEffect(() => {
    function onUnload() {
      if (localStorage.getItem('nt-auto-clean') !== 'false') {
        navigator.sendBeacon('/api/cache/clear');
      }
    }
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  function cycleTheme() {
    setTheme(t => t === 'auto' ? 'dark' : t === 'dark' ? 'light' : 'auto');
  }

  // Navigate to a new view; prompt if leaving a large pcap file (>50 MB)
  function navigate(newView) {
    if (view === 'pcap' && newView !== 'pcap' && pcapFileInfo.pcapId && pcapFileInfo.fileSize > 50 * 1024 * 1024) {
      const mb = (pcapFileInfo.fileSize / 1024 / 1024).toFixed(1);
      const ok = window.confirm(`The loaded PCAP file is ${mb} MB. Close it to free memory?`);
      if (ok) {
        setPcapKey(k => k + 1);
        setPcapFileInfo({ pcapId: null, fileSize: 0 });
      }
    }
    setView(newView);
  }

  return (
    <div className="app">
      {/* Global mouse spotlight */}
      <div className="mouse-spotlight" aria-hidden="true" />

      {/* Ambient background orbs */}
      <div className="bg-orb bg-orb-1" aria-hidden="true" />
      <div className="bg-orb bg-orb-2" aria-hidden="true" />
      <div className="bg-orb bg-orb-3" aria-hidden="true" />

      {/* Floating sidebar */}
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
            {NAV.map((item) => (
              <button
                key={item.id}
                className={`nav-item${view === item.id ? ' active' : ''}`}
                onClick={() => navigate(item.id)}
                title={sidebarCollapsed ? item.label : ''}
              >
                <span className="nav-icon">{item.icon}</span>
                {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button className="theme-btn" onClick={cycleTheme} title={`Theme: ${theme}`}>
              {theme === 'light' ? <SunIcon /> : theme === 'dark' ? <MoonIcon /> : <span className="theme-auto">A</span>}
              {!sidebarCollapsed && <span>{theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}</span>}
            </button>

            {!sidebarCollapsed && (
              <div className={`conn-status ${connected ? 'connected' : 'disconnected'}`}>
                <span className="status-dot" />
                <span className="conn-text">
                  {connected && connInfo ? `${connInfo.username}@${connInfo.host}` : 'Not connected'}
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

        {/* Collapse toggle — outside inner wrapper, shows on sidebar hover */}
        <button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed(v => !v)} title={sidebarCollapsed ? 'Expand' : 'Collapse'}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {sidebarCollapsed
              ? <path d="M4 2l4 4-4 4"/>
              : <path d="M8 2L4 6l4 4"/>}
          </svg>
        </button>
      </aside>

      {/* Main content */}
      <main className={`main-content${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <div style={{ display: view === 'ssh' ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <SSHWorkspace
            sessionId={sessionId} setSessionId={setSessionId}
            connected={connected} setConnected={setConnected}
            connInfo={connInfo} setConnInfo={setConnInfo}
          />
        </div>
        {view === 'pcap' && <PcapAnalyzer key={pcapKey} onFileLoaded={(id, size) => setPcapFileInfo({ pcapId: id, fileSize: size })} />}
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
        {view === 'settings' && <Settings theme={theme} setTheme={setTheme} />}
      </main>
    </div>
  );
}
