import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';

// ── constants ─────────────────────────────────────────────────────────────────
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_COLORS = {
  GET:     '#3fb950', POST:    '#38bdf8', PUT:  '#fbbf24',
  PATCH:   '#c084fc', DELETE:  '#f87171',
  HEAD:    '#94a3b8', OPTIONS: '#94a3b8',
};
const BODY_TABS  = ['none', 'json', 'form', 'raw'];
const RESP_TABS  = ['body', 'headers', 'cookies', 'redirects'];
const AUTH_TYPES = ['none', 'bearer', 'basic', 'apikey'];
const LS_HISTORY = 'nt-api-history';
const LS_SAVED   = 'nt-api-saved';
const LS_ENVS    = 'nt-api-envs';
const MAX_HISTORY = 50;

// ── helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function loadLS(key, fb) { try { return JSON.parse(localStorage.getItem(key)) ?? fb; } catch { return fb; } }
function saveLS(key, v)  { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

function resolveEnv(str, vars) {
  if (!str) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const f = vars.find(v => v.key === k && v.enabled !== false);
    return f ? f.value : `{{${k}}}`;
  });
}

function statusColor(s) {
  if (!s)    return 'var(--text-3)';
  if (s < 300) return '#3fb950';
  if (s < 400) return '#fbbf24';
  return '#f87171';
}
function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024)      return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}
function tryPrettyJson(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } }
function isJson(s) { try { JSON.parse(s); return true; } catch { return false; } }

// ── MethodSelect ──────────────────────────────────────────────────────────────
function MethodSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) {
      if (!btnRef.current?.contains(e.target) &&
          !document.getElementById('method-dropdown-portal')?.contains(e.target)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  function toggle() {
    if (!open) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 5, left: r.left, width: r.width });
    }
    setOpen(o => !o);
  }

  const color = METHOD_COLORS[value] || 'var(--text-2)';

  return (
    <div className="method-select-wrap">
      <button
        ref={btnRef}
        className="method-select-btn"
        style={{ color }}
        onClick={toggle}
        type="button"
      >
        <span className="method-select-label">{value}</span>
        <svg className={`method-chevron ${open ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && createPortal(
        <div
          id="method-dropdown-portal"
          className="method-dropdown"
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
        >
          {METHODS.map(m => (
            <button
              key={m}
              className={`method-opt ${m === value ? 'active' : ''}`}
              style={{ color: METHOD_COLORS[m] || 'var(--text-2)' }}
              onClick={() => { onChange(m); setOpen(false); }}
              type="button"
            >
              {m}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── KVTable ───────────────────────────────────────────────────────────────────
function KVTable({ rows, onChange, keyPlaceholder = 'Key', valPlaceholder = 'Value' }) {
  function update(i, field, val) { onChange(rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r)); }
  function remove(i) { onChange(rows.filter((_, idx) => idx !== i)); }
  function add() { onChange([...rows, { id: uid(), key: '', value: '', enabled: true }]); }
  return (
    <div className="kv-table">
      {rows.map((r, i) => (
        <div key={r.id} className="kv-row">
          <input type="checkbox" className="kv-check" checked={r.enabled !== false} onChange={e => update(i, 'enabled', e.target.checked)} />
          <input className="kv-input" placeholder={keyPlaceholder} value={r.key} onChange={e => update(i, 'key', e.target.value)} />
          <input className="kv-input" placeholder={valPlaceholder} value={r.value} onChange={e => update(i, 'value', e.target.value)} />
          <button className="kv-del" onClick={() => remove(i)} title="Remove">×</button>
        </div>
      ))}
      <button className="kv-add" onClick={add}>+ Add</button>
    </div>
  );
}

// ── JsonEditor ────────────────────────────────────────────────────────────────
function JsonEditor({ value, onChange }) {
  const [err, setErr] = useState('');
  function format() {
    try { onChange(JSON.stringify(JSON.parse(value), null, 2)); setErr(''); }
    catch (e) { setErr(e.message); }
  }
  return (
    <div className="json-editor-wrap">
      <div className="json-editor-toolbar">
        <span className={`json-valid-badge ${isJson(value) ? 'ok' : value ? 'err' : ''}`}>
          {value ? (isJson(value) ? 'Valid JSON' : 'Invalid JSON') : ''}
        </span>
        <button className="btn-xs" onClick={format}>Format</button>
      </div>
      <textarea className="json-editor" value={value} onChange={e => { onChange(e.target.value); setErr(''); }}
        spellCheck={false} placeholder={'{\n  "key": "value"\n}'} />
      {err && <div className="json-err">{err}</div>}
    </div>
  );
}

// ── AuthPanel ─────────────────────────────────────────────────────────────────
function AuthPanel({ auth, onChange }) {
  const { type = 'none', token = '', username = '', password = '', keyName = 'X-API-Key', keyValue = '', addTo = 'header' } = auth;
  function set(field, val) { onChange({ ...auth, [field]: val }); }

  return (
    <div className="auth-panel">
      <div className="auth-type-bar">
        {AUTH_TYPES.map(t => (
          <button key={t} type="button"
            className={`body-type-btn ${type === t ? 'active' : ''}`}
            onClick={() => set('type', t)}>
            {t === 'none' ? 'None' : t === 'bearer' ? 'Bearer Token' : t === 'basic' ? 'Basic Auth' : 'API Key'}
          </button>
        ))}
      </div>

      {type === 'bearer' && (
        <div className="auth-fields">
          <label className="auth-label">Token</label>
          <input className="auth-input" type="password" placeholder="eyJhbGci…" value={token} onChange={e => set('token', e.target.value)} />
          <p className="auth-hint">Sent as: <code>Authorization: Bearer {'{token}'}</code></p>
        </div>
      )}

      {type === 'basic' && (
        <div className="auth-fields">
          <label className="auth-label">Username</label>
          <input className="auth-input" placeholder="username" value={username} onChange={e => set('username', e.target.value)} />
          <label className="auth-label" style={{ marginTop: 8 }}>Password</label>
          <input className="auth-input" type="password" placeholder="password" value={password} onChange={e => set('password', e.target.value)} />
          <p className="auth-hint">Sent as: <code>Authorization: Basic {'{base64}'}</code></p>
        </div>
      )}

      {type === 'apikey' && (
        <div className="auth-fields">
          <div className="auth-row">
            <div style={{ flex: 1 }}>
              <label className="auth-label">Key name</label>
              <input className="auth-input" placeholder="X-API-Key" value={keyName} onChange={e => set('keyName', e.target.value)} />
            </div>
            <div style={{ flex: 2 }}>
              <label className="auth-label">Value</label>
              <input className="auth-input" type="password" placeholder="your-key" value={keyValue} onChange={e => set('keyValue', e.target.value)} />
            </div>
          </div>
          <div className="auth-add-to">
            <span className="auth-label">Add to</span>
            {['header', 'query'].map(opt => (
              <label key={opt} className="auth-radio">
                <input type="radio" checked={addTo === opt} onChange={() => set('addTo', opt)} /> {opt}
              </label>
            ))}
          </div>
        </div>
      )}

      {type === 'none' && (
        <p className="auth-hint" style={{ marginTop: 10 }}>No authentication will be sent with this request.</p>
      )}
    </div>
  );
}

// ── ResponseBody ──────────────────────────────────────────────────────────────
function ResponseBody({ body, contentType }) {
  const isJ = contentType?.includes('json') || isJson(body);
  return <pre className={`resp-body ${isJ ? 'resp-json' : ''}`}>{isJ ? tryPrettyJson(body) : body}</pre>;
}

// ── HistoryPanel / SavedPanel / EnvPanel (unchanged) ──────────────────────────
function HistoryPanel({ history, onLoad, onClear }) {
  if (!history.length) return <div className="side-empty">No history yet</div>;
  return (
    <div className="side-list">
      <div className="side-list-header"><span>History</span><button className="btn-xs danger" onClick={onClear}>Clear</button></div>
      {history.map(h => (
        <button key={h.id} className="side-item" onClick={() => onLoad(h)}>
          <span className={`method-badge sm ${h.method.toLowerCase()}`}>{h.method}</span>
          <span className="side-item-url" title={h.url}>{h.url}</span>
          {h.status && <span className="side-item-status" style={{ color: statusColor(h.status) }}>{h.status}</span>}
        </button>
      ))}
    </div>
  );
}
function SavedPanel({ saved, onLoad, onDelete }) {
  if (!saved.length) return <div className="side-empty">No saved requests</div>;
  return (
    <div className="side-list">
      <div className="side-list-header"><span>Saved</span></div>
      {saved.map(s => (
        <div key={s.id} className="side-item-row">
          <button className="side-item" style={{ flex: 1 }} onClick={() => onLoad(s)}>
            <span className={`method-badge sm ${s.method.toLowerCase()}`}>{s.method}</span>
            <span className="side-item-url" title={s.url}>{s.name || s.url}</span>
          </button>
          <button className="kv-del" onClick={() => onDelete(s.id)} title="Delete">×</button>
        </div>
      ))}
    </div>
  );
}
function EnvPanel({ envs, onChange }) {
  return (
    <div className="side-list">
      <div className="side-list-header"><span>Environment Variables</span></div>
      <div style={{ padding: '0 8px 8px' }}>
        <KVTable rows={envs} onChange={onChange} keyPlaceholder="Variable" valPlaceholder="Value" />
      </div>
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function ApiTester() {
  const [method,   setMethod]   = useState('GET');
  const [url,      setUrl]      = useState('');
  const [reqTab,   setReqTab]   = useState('params');
  const [params,   setParams]   = useState([]);
  const [reqHeaders, setReqHeaders] = useState([]);
  const [auth,     setAuth]     = useState({ type: 'none' });
  const [bodyTab,  setBodyTab]  = useState('none');
  const [jsonBody, setJsonBody] = useState('');
  const [formBody, setFormBody] = useState([]);
  const [rawBody,  setRawBody]  = useState('');
  const [followRedirects, setFollowRedirects] = useState(true);

  const [response, setResponse] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [respTab,  setRespTab]  = useState('body');

  const [sidePanel, setSidePanel] = useState(null);
  const [history, setHistory]  = useState(() => loadLS(LS_HISTORY, []));
  const [saved,   setSaved]    = useState(() => loadLS(LS_SAVED, []));
  const [envs,    setEnvs]     = useState(() => loadLS(LS_ENVS, []));

  useEffect(() => { saveLS(LS_HISTORY, history); }, [history]);
  useEffect(() => { saveLS(LS_SAVED, saved); }, [saved]);
  useEffect(() => { saveLS(LS_ENVS, envs); }, [envs]);

  // Ctrl+Enter
  useEffect(() => {
    function onKey(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function buildUrl() {
    const base = resolveEnv(url, envs);
    const active = params.filter(p => p.enabled !== false && p.key);
    if (!active.length) return base;
    try {
      const u = new URL(base);
      active.forEach(p => u.searchParams.set(resolveEnv(p.key, envs), resolveEnv(p.value, envs)));
      return u.toString();
    } catch {
      const qs = active.map(p => `${encodeURIComponent(resolveEnv(p.key, envs))}=${encodeURIComponent(resolveEnv(p.value, envs))}`).join('&');
      return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
    }
  }

  function applyAuth(hdrs) {
    const h = { ...hdrs };
    const { type, token, username, password, keyName, keyValue, addTo } = auth;
    if (type === 'bearer' && token) {
      h['Authorization'] = `Bearer ${token}`;
    } else if (type === 'basic' && (username || password)) {
      h['Authorization'] = `Basic ${btoa(`${username || ''}:${password || ''}`)}`;
    } else if (type === 'apikey' && keyName && keyValue && addTo === 'header') {
      h[keyName] = keyValue;
    }
    return h;
  }

  function applyAuthQuery(finalUrl) {
    if (auth.type === 'apikey' && auth.keyName && auth.keyValue && auth.addTo === 'query') {
      try {
        const u = new URL(finalUrl);
        u.searchParams.set(auth.keyName, auth.keyValue);
        return u.toString();
      } catch { return finalUrl; }
    }
    return finalUrl;
  }

  async function send() {
    let finalUrl = buildUrl();
    if (!finalUrl) return;
    finalUrl = applyAuthQuery(finalUrl);

    setLoading(true); setError(''); setResponse(null);

    const hdrs = {};
    reqHeaders.filter(h => h.enabled !== false && h.key).forEach(h => {
      hdrs[resolveEnv(h.key, envs)] = resolveEnv(h.value, envs);
    });
    const authHdrs = applyAuth(hdrs);

    let body;
    if (!['GET', 'HEAD'].includes(method)) {
      if (bodyTab === 'json' && jsonBody.trim()) {
        body = jsonBody;
        if (!authHdrs['Content-Type'] && !authHdrs['content-type']) authHdrs['Content-Type'] = 'application/json';
      } else if (bodyTab === 'form') {
        const pairs = formBody.filter(r => r.enabled !== false && r.key);
        body = pairs.map(r => `${encodeURIComponent(resolveEnv(r.key, envs))}=${encodeURIComponent(resolveEnv(r.value, envs))}`).join('&');
        if (!authHdrs['Content-Type'] && !authHdrs['content-type']) authHdrs['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (bodyTab === 'raw' && rawBody.trim()) {
        body = rawBody;
      }
    }

    try {
      const { data } = await axios.post('/api/request/send', {
        method, url: finalUrl, headers: authHdrs, body, followRedirects,
      });
      setResponse(data);
      setRespTab('body');
      const entry = { id: uid(), method, url: finalUrl, status: data.status, ts: Date.now() };
      setHistory(h => [entry, ...h].slice(0, MAX_HISTORY));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  function loadRequest(req) {
    setMethod(req.method || 'GET');
    setUrl(req.url || '');
    if (req.params)     setParams(req.params);
    if (req.reqHeaders) setReqHeaders(req.reqHeaders);
    if (req.auth)       setAuth(req.auth);
    if (req.bodyTab)    setBodyTab(req.bodyTab);
    if (req.jsonBody !== undefined) setJsonBody(req.jsonBody);
    if (req.formBody)   setFormBody(req.formBody);
    if (req.rawBody !== undefined)  setRawBody(req.rawBody);
    setSidePanel(null);
  }

  function saveRequest() {
    const name = prompt('Save as:', url);
    if (!name) return;
    const entry = { id: uid(), name, method, url, params, reqHeaders, auth, bodyTab, jsonBody, formBody, rawBody };
    setSaved(s => [entry, ...s]);
  }

  const REQ_TABS = ['params', 'headers', 'auth', 'body'];
  const respContentType = response?.headers?.['content-type'] || '';

  return (
    <div className="api-tester">

      {/* ── URL bar ── */}
      <div className="api-url-bar">
        <MethodSelect value={method} onChange={setMethod} />
        <input
          className="url-input"
          placeholder="https://api.example.com/endpoint  (supports {{VAR}})"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button className="btn-send" onClick={send} disabled={loading} type="button">
          {loading ? <span className="spinner-sm" /> : 'Send'}
        </button>
        <button className="btn-save-req" onClick={saveRequest} title="Save request" type="button">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 1H3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V4l-3-3z"/><path d="M11 1v4H5V1M5 9h6M5 12h4"/>
          </svg>
        </button>
      </div>

      {/* ── Options row ── */}
      <div className="api-options-row">
        <label className="api-opt-check">
          <input type="checkbox" checked={followRedirects} onChange={e => setFollowRedirects(e.target.checked)} />
          <span className="api-opt-check-label">Follow redirects</span>
        </label>
        <span className="api-shortcut-hint">Ctrl+Enter to send</span>
        <div style={{ flex: 1 }} />
        {['history', 'saved', 'env'].map(p => (
          <button key={p} type="button"
            className={`btn-side-toggle ${sidePanel === p ? 'active' : ''}`}
            onClick={() => setSidePanel(sidePanel === p ? null : p)}>
            {p === 'history' ? 'History' : p === 'saved' ? 'Saved' : 'Env'}
          </button>
        ))}
      </div>

      <div className="api-body">
        <div className="api-main">

          {/* ── Request panel ── */}
          <div className="api-section">
            <div className="tab-bar">
              {REQ_TABS.map(t => (
                <button key={t} className={`tab-btn ${reqTab === t ? 'active' : ''}`} onClick={() => setReqTab(t)} type="button">
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                  {t === 'params' && params.filter(p => p.key).length > 0 && <span className="tab-badge">{params.filter(p => p.key).length}</span>}
                  {t === 'headers' && reqHeaders.filter(h => h.key).length > 0 && <span className="tab-badge">{reqHeaders.filter(h => h.key).length}</span>}
                  {t === 'auth' && auth.type !== 'none' && <span className="tab-badge auth-badge">ON</span>}
                </button>
              ))}
            </div>
            <div className="tab-content">
              {reqTab === 'params'  && <KVTable rows={params} onChange={setParams} keyPlaceholder="Parameter" />}
              {reqTab === 'headers' && <KVTable rows={reqHeaders} onChange={setReqHeaders} keyPlaceholder="Header" />}
              {reqTab === 'auth'    && <AuthPanel auth={auth} onChange={setAuth} />}
              {reqTab === 'body'    && (
                <div className="body-section">
                  <div className="body-type-bar">
                    {BODY_TABS.map(t => (
                      <button key={t} type="button" className={`body-type-btn ${bodyTab === t ? 'active' : ''}`} onClick={() => setBodyTab(t)}>
                        {t === 'none' ? 'None' : t === 'json' ? 'JSON' : t === 'form' ? 'Form' : 'Raw'}
                      </button>
                    ))}
                  </div>
                  {bodyTab === 'json' && <JsonEditor value={jsonBody} onChange={setJsonBody} />}
                  {bodyTab === 'form' && <KVTable rows={formBody} onChange={setFormBody} keyPlaceholder="Field" />}
                  {bodyTab === 'raw'  && <textarea className="raw-editor" value={rawBody} onChange={e => setRawBody(e.target.value)} placeholder="Request body…" spellCheck={false} />}
                  {bodyTab === 'none' && <div className="body-none-msg">No body</div>}
                </div>
              )}
            </div>
          </div>

          {/* ── Response panel ── */}
          <div className="api-section resp-section">
            {!response && !error && !loading && (
              <div className="resp-empty">Send a request to see the response</div>
            )}
            {loading && <div className="resp-empty"><span className="spinner-sm" /> Sending…</div>}
            {error   && <div className="resp-error">{error}</div>}
            {response && (
              <>
                <div className="resp-meta-bar">
                  <span className="resp-status" style={{ color: statusColor(response.status) }}>
                    {response.status} {response.statusText}
                  </span>
                  <span className="resp-timing">{response.elapsed}ms</span>
                  <span className="resp-size">{fmtSize(response.size)}</span>
                </div>
                <div className="tab-bar">
                  {RESP_TABS.map(t => (
                    <button key={t} className={`tab-btn ${respTab === t ? 'active' : ''}`} onClick={() => setRespTab(t)} type="button">
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                      {t === 'redirects' && response.redirects?.length > 0 && <span className="tab-badge">{response.redirects.length}</span>}
                      {t === 'cookies'   && response.cookies?.length   > 0 && <span className="tab-badge">{response.cookies.length}</span>}
                    </button>
                  ))}
                </div>
                <div className="tab-content resp-tab-content">
                  {respTab === 'body' && <ResponseBody body={response.body} contentType={respContentType} />}
                  {respTab === 'headers' && (
                    <table className="resp-headers-table"><tbody>
                      {Object.entries(response.headers).map(([k, v]) => (
                        <tr key={k}><td className="rh-key">{k}</td><td className="rh-val">{v}</td></tr>
                      ))}
                    </tbody></table>
                  )}
                  {respTab === 'cookies' && (
                    <div className="resp-cookies">
                      {response.cookies?.length ? response.cookies.map((c, i) => <div key={i} className="cookie-row">{c}</div>) : <div className="resp-empty">No cookies</div>}
                    </div>
                  )}
                  {respTab === 'redirects' && (
                    <div className="resp-redirects">
                      {response.redirects?.length ? response.redirects.map((r, i) => (
                        <div key={i} className="redirect-row">
                          <span className="redirect-status" style={{ color: statusColor(r.status) }}>{r.status}</span>
                          <span className="redirect-url">{r.url}</span>
                          <span className="redirect-arrow">→</span>
                          <span className="redirect-loc">{r.location}</span>
                        </div>
                      )) : <div className="resp-empty">No redirects</div>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

        </div>

        {/* ── Side panel ── */}
        {sidePanel && (
          <div className="api-side-panel">
            {sidePanel === 'history' && <HistoryPanel history={history} onLoad={loadRequest} onClear={() => setHistory([])} />}
            {sidePanel === 'saved'   && <SavedPanel saved={saved} onLoad={loadRequest} onDelete={id => setSaved(s => s.filter(x => x.id !== id))} />}
            {sidePanel === 'env'     && <EnvPanel envs={envs} onChange={setEnvs} />}
          </div>
        )}
      </div>
    </div>
  );
}
