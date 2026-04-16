import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useT } from '../i18n.js';

export default function SSHTerminal({ sessionId, setSessionId, connected, setConnected }) {
  const t = useT();
  const [form, setForm] = useState({ host: '', port: '22', username: '', password: '' });
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    if (!connected || !sessionId) return;

    let term, fitAddon, ws;

    async function boot() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      await import('@xterm/xterm/css/xterm.css');

      term = new Terminal({ cursorBlink: true, theme: { background: '#000000' }, fontSize: 14 });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(termRef.current);
      fitAddon.fit();
      xtermRef.current = term;
      fitRef.current = fitAddon;

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/ssh/terminal/${sessionId}`);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'data') term.write(atob(msg.data));
        else if (msg.type === 'error') { term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`); }
        else if (msg.type === 'closed') { term.write(`\r\n\x1b[33m${t.sshConnClosed}\x1b[0m\r\n`); }
      };

      ws.onclose = () => term.write(`\r\n\x1b[33m${t.sshWsClosed}\x1b[0m\r\n`);

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'data', data: btoa(data) }));
      });

      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      });
    }

    boot().catch(console.error);

    const onResize = () => fitRef.current?.fit();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      ws?.close();
      term?.dispose();
    };
  }, [connected, sessionId]);

  async function handleConnect(e) {
    e.preventDefault();
    setError('');
    setConnecting(true);
    try {
      const { data } = await axios.post('/api/ssh/connect', {
        host: form.host,
        port: Number(form.port),
        username: form.username,
        password: form.password,
      });
      setSessionId(data.sessionId);
      setConnected(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (sessionId) await axios.delete(`/api/ssh/disconnect/${sessionId}`).catch(() => {});
    wsRef.current?.close();
    xtermRef.current?.dispose();
    xtermRef.current = null;
    setSessionId(null);
    setConnected(false);
  }

  if (!connected) {
    return (
      <form className="connect-form" onSubmit={handleConnect}>
        <h2>{t.sshTermTitle}</h2>
        <input placeholder={t.sshHostIp} value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
        <div className="form-row">
          <input placeholder={t.port} value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} style={{ width: 80 }} />
          <input placeholder={t.username} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        </div>
        <input type="password" placeholder={t.password} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        {error && <span className="error-msg">{error}</span>}
        <button className="primary" type="submit" disabled={connecting}>
          {connecting ? t.sshConnecting : t.connect}
        </button>
      </form>
    );
  }

  return (
    <div className="terminal-wrap">
      <div className="terminal-toolbar">
        <span style={{ fontSize: 12, color: '#8b949e' }}>
          {form.username}@{form.host}:{form.port}
        </span>
        <button className="danger" onClick={handleDisconnect}>{t.disconnect}</button>
      </div>
      <div id="xterm-container" ref={termRef} style={{ flex: 1 }} />
    </div>
  );
}
