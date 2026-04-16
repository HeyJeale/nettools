import React, { useState, useRef } from 'react';
import axios from 'axios';
import { useT } from '../i18n.js';

function fmtSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function fmtDate(ts) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString();
}

export default function FileManager({ sessionId, connected }) {
  const t = useT();
  const [remotePath, setRemotePath] = useState('.');
  const [pathInput, setPathInput] = useState('.');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef(null);

  async function loadDir(p) {
    setLoading(true); setError('');
    try {
      const { data } = await axios.get('/api/scp/list', { params: { sessionId, remotePath: p } });
      setFiles(data.files);
      setRemotePath(p);
      setPathInput(p);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  function navigateTo(name, isDir) {
    if (!isDir) return;
    const next = remotePath === '.' ? name : `${remotePath}/${name}`;
    loadDir(next);
  }

  function goUp() {
    const parts = remotePath.split('/').filter(Boolean);
    parts.pop();
    loadDir(parts.length ? parts.join('/') : '/');
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
      setUploadStatus(t.fmUploadComplete);
      loadDir(remotePath);
    } catch (err) {
      setUploadStatus(t.fmError(err.response?.data?.error || err.message));
    }
  }

  function handleDownload(name) {
    const path = remotePath === '.' ? name : `${remotePath}/${name}`;
    const url = `/api/scp/download?sessionId=${encodeURIComponent(sessionId)}&remotePath=${encodeURIComponent(path)}`;
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
  }

  if (!connected) {
    return (
      <div style={{ padding: 40, color: '#8b949e', textAlign: 'center' }}>
        {t.fmConnectFirst}
      </div>
    );
  }

  return (
    <div className="file-manager">
      <div className="section">
        <h3>{t.fmRemoteFiles}</h3>
        <div className="path-bar" style={{ marginTop: 10 }}>
          <button className="secondary" onClick={goUp}>{t.fmUp}</button>
          <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadDir(pathInput)} />
          <button className="secondary" onClick={() => loadDir(pathInput)}>{t.fmGo}</button>
          <button className="primary" onClick={() => loadDir(remotePath)}>{t.refresh}</button>
        </div>
        {error && <div className="error-msg" style={{ marginTop: 8 }}>{error}</div>}
        {loading ? (
          <div style={{ padding: 20, color: '#8b949e' }}>{t.loading}</div>
        ) : (
          <table className="file-table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>{t.name}</th><th>{t.size}</th><th>{t.modified}</th><th></th></tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td>
                    {f.isDir
                      ? <span className="dir" onClick={() => navigateTo(f.name, true)}>📁 {f.name}</span>
                      : `📄 ${f.name}`}
                  </td>
                  <td>{fmtSize(f.size)}</td>
                  <td>{fmtDate(f.mtime)}</td>
                  <td>
                    {!f.isDir && (
                      <button className="secondary" onClick={() => handleDownload(f.name)}>{t.download}</button>
                    )}
                  </td>
                </tr>
              ))}
              {files.length === 0 && <tr><td colSpan={4} style={{ color: '#8b949e', padding: 12 }}>{t.sshEmptyDir}</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <h3>{t.fmUploadTo(remotePath)}</h3>
        <div
          className="upload-zone"
          style={{ marginTop: 10 }}
          onClick={() => fileInputRef.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) { fileInputRef.current.files = e.dataTransfer.files; handleUpload({ target: { files: e.dataTransfer.files } }); }
          }}
        >
          {t.fmClickDrag}
        </div>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
        {uploadStatus && <div style={{ marginTop: 8, fontSize: 12, color: '#8b949e' }}>{uploadStatus}</div>}
      </div>
    </div>
  );
}
