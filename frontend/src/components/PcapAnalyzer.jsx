import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { XMLParser } from 'fast-xml-parser';
import { useT } from '../i18n.js';

const PROTO_COLORS = {
  TCP: '#79c0ff', UDP: '#56d364', HTTP: '#e3b341', HTTPS: '#f0883e',
  DNS: '#bc8cff', ICMP: '#ff7b72', ARP: '#8b949e',
};
function protoColor(p) { return PROTO_COLORS[p] || '#c9d1d9'; }
function protoClass(p) { return `proto-${(p || '').toLowerCase()}`; }

function hexDump(hex) {
  const bytes = hex.match(/.{1,2}/g) || [];
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hexPart = chunk.map((b) => b.padStart(2, '0')).join(' ').padEnd(47);
    const asciiPart = chunk.map((b) => {
      const c = parseInt(b, 16);
      return c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
    }).join('');
    lines.push(`${i.toString(16).padStart(4, '0')}  ${hexPart}  ${asciiPart}`);
  }
  return lines.join('\n');
}

// ── Packet Detail Modal ────────────────────────────────────────────────────────
function LayerSection({ title, color, fields, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pd-layer">
      <button className="pd-layer-hdr" onClick={() => setOpen(o => !o)} style={{ borderLeftColor: color }}>
        <svg className={`pd-chevron ${open ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
        <span className="pd-layer-title">{title}</span>
      </button>
      {open && (
        <div className="pd-layer-body">
          {fields && fields.map(([k, v]) => v != null && (
            <div className="pd-field" key={k}>
              <span className="pd-field-key">{k}</span>
              <span className="pd-field-val">{String(v)}</span>
            </div>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}

// ── XML Tree Viewer ────────────────────────────────────────────────────────────
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
});

function XmlNode({ name, value, depth }) {
  const [open, setOpen] = useState(depth < 2);
  if (typeof value !== 'object' || value === null) {
    return (
      <div className="xml-leaf" style={{ paddingLeft: depth * 14 }}>
        <span className="xml-tag">&lt;{name}&gt;</span>
        <span className="xml-val">{String(value)}</span>
        <span className="xml-tag">&lt;/{name}&gt;</span>
      </div>
    );
  }
  const attrs = Object.entries(value).filter(([k]) => k.startsWith('@_'));
  const children = Object.entries(value).filter(([k]) => !k.startsWith('@_') && k !== '#text');
  const text = value['#text'];
  const hasChildren = children.length > 0 || text != null;
  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <button className="xml-node-hdr" onClick={() => setOpen(o => !o)}>
        {hasChildren && (
          <svg className={`pd-chevron ${open ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        )}
        <span className="xml-tag">&lt;{name}</span>
        {attrs.map(([k, v]) => (
          <span key={k} className="xml-attr"> {k.slice(2)}=<span className="xml-attr-val">"{String(v)}"</span></span>
        ))}
        <span className="xml-tag">&gt;</span>
        {!open && hasChildren && <span className="xml-ellipsis">…</span>}
        {!hasChildren && <span className="xml-tag">&lt;/{name}&gt;</span>}
      </button>
      {open && hasChildren && (
        <div>
          {text != null && <span className="xml-val" style={{ paddingLeft: 14 }}>{String(text)}</span>}
          {children.map(([k, v]) =>
            Array.isArray(v)
              ? v.map((item, i) => <XmlNode key={`${k}-${i}`} name={k} value={item} depth={depth + 1} />)
              : <XmlNode key={k} name={k} value={v} depth={depth + 1} />
          )}
          <span className="xml-tag">&lt;/{name}&gt;</span>
        </div>
      )}
    </div>
  );
}

function XmlTree({ xml }) {
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    try { setParsed(xmlParser.parse(xml)); }
    catch (e) { setErr(e.message); }
  }, [xml]);
  if (err || !parsed) return <pre className="pd-body-pre">{xml}</pre>;
  return (
    <div className="xml-tree">
      {Object.entries(parsed).map(([k, v]) => <XmlNode key={k} name={k} value={v} depth={0} />)}
    </div>
  );
}

function HttpSection({ http }) {
  const t = useT();
  const isReq = http.kind === 'request';
  const color = isReq ? '#e3b341' : '#56d364';
  const title = isReq
    ? `HTTP Request — ${http.method} ${http.url}`
    : `HTTP Response — ${http.status} ${http.statusText || ''}`;
  const ct = http.headers?.['content-type'] || '';
  const isJson = ct.includes('json');
  const isXml  = ct.includes('xml') || ct.includes('html');
  return (
    <LayerSection title={title} color={color} defaultOpen={true}>
      <div className="pd-field">
        <span className="pd-field-key">{t.version}</span>
        <span className="pd-field-val">{http.version}</span>
      </div>
      {isReq && (
        <>
          <div className="pd-field"><span className="pd-field-key">Method</span><span className="pd-field-val">{http.method}</span></div>
          <div className="pd-field"><span className="pd-field-key">URL</span><span className="pd-field-val">{http.url}</span></div>
        </>
      )}
      {!isReq && (
        <>
          <div className="pd-field"><span className="pd-field-key">Status code</span><span className="pd-field-val">{http.status}</span></div>
          <div className="pd-field"><span className="pd-field-key">Reason phrase</span><span className="pd-field-val">{http.statusText}</span></div>
        </>
      )}
      <div className="pd-sub-label">{t.headers}</div>
      {Object.entries(http.headers || {}).map(([k, v]) => (
        <div className="pd-field" key={k}><span className="pd-field-key">{k}</span><span className="pd-field-val">{v}</span></div>
      ))}
      {http.body && (
        <>
          <div className="pd-sub-label">{t.body}</div>
          {isXml ? <XmlTree xml={http.body} /> : <pre className={`pd-body-pre ${isJson ? 'json' : ''}`}>{http.body}</pre>}
        </>
      )}
    </LayerSection>
  );
}

function PacketDetailModal({ pkt, onClose }) {
  const t = useT();
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flagStr = pkt.tcpFlags
    ? Object.entries(pkt.tcpFlags).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(', ')
    : null;

  return createPortal(
    <div className="pd-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pd-modal">
        <div className="pd-modal-hdr">
          <div className="pd-modal-title">
            <span className={`proto-tag ${protoClass(pkt.protocol)}`}>{pkt.protocol}</span>
            <span className="pd-modal-summary">{pkt.summary}</span>
          </div>
          <div className="pd-modal-meta">
            <span>#{(pkt.pktIndex ?? 0) + 1}</span>
            <span>{pkt.ts?.toFixed(6)}s</span>
            <span>{pkt.len} bytes</span>
          </div>
          <button className="pd-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="pd-modal-body">
          <div className="pd-layers">
            <LayerSection title={t.pcapFrame} color="#8b949e" fields={[
              [t.pcapCapturedLen, `${pkt.capLen} bytes`],
              [t.pcapOriginalLen, `${pkt.len} bytes`],
              [t.pcapTimestamp, pkt.ts?.toFixed(9)],
            ]} />
            {pkt.ethSrc && (
              <LayerSection title={t.pcapEthernet} color="#58a6ff" fields={[
                [t.destination, pkt.ethDst],
                [t.source, pkt.ethSrc],
                [t.type, pkt.etherType],
              ]} />
            )}
            {pkt.protocol === 'ARP' && pkt.arpOp && (
              <LayerSection title={t.pcapArp} color={protoColor('ARP')} fields={[
                [t.pcapOperation, pkt.arpOp],
                [t.pcapSenderMac, pkt.arpSenderMac],
                [t.pcapSenderIp, pkt.arpSenderIP],
                [t.pcapTargetMac, pkt.arpTargetMac],
                [t.pcapTargetIp, pkt.arpTargetIP],
              ]} />
            )}
            {pkt.srcIP && (
              <LayerSection title={t.pcapIpv4} color="#79c0ff" fields={[
                [t.version, pkt.ipVersion],
                [t.pcapHeaderLen, `${pkt.ipIHL} bytes`],
                ['DSCP/TOS', `0x${(pkt.ipTOS || 0).toString(16).padStart(2, '0')}`],
                [t.pcapTotalLen, pkt.ipTotalLen],
                [t.pcapIdentification, `0x${(pkt.ipId || 0).toString(16).padStart(4, '0')}`],
                [t.flags, `0x${(pkt.ipFlags || 0).toString(16)} (DF=${!!(pkt.ipFlags & 2) ? 1 : 0})`],
                [t.pcapFragOffset, pkt.ipFragOff],
                [t.pcapTtl, pkt.ttl],
                [t.protocol, pkt.ipProto],
                [t.checksum, pkt.ipChecksum],
                [t.source, pkt.srcIP],
                [t.destination, pkt.dstIP],
              ]} />
            )}
            {pkt.protocol === 'ICMP' && (
              <LayerSection title={t.pcapIcmp} color={protoColor('ICMP')} fields={[
                [t.type, pkt.icmpType],
                [t.pcapCode, pkt.icmpCode],
                [t.checksum, pkt.icmpChecksum],
              ]} />
            )}
            {(pkt.protocol === 'UDP' || pkt.protocol === 'DNS') && pkt.srcPort != null && (
              <LayerSection title={t.pcapUdp} color={protoColor('UDP')} fields={[
                [t.pcapSrcPort, pkt.srcPort],
                [t.pcapDstPort, pkt.dstPort],
                [t.length, pkt.udpLen],
                [t.checksum, pkt.udpChecksum],
              ]} />
            )}
            {(pkt.protocol === 'TCP' || pkt.protocol === 'HTTP' || pkt.protocol === 'HTTPS') && pkt.srcPort != null && (
              <LayerSection title={t.pcapTcp} color={protoColor('TCP')} fields={[
                [t.pcapSrcPort, pkt.srcPort],
                [t.pcapDstPort, pkt.dstPort],
                [t.pcapSeqNum, pkt.tcpSeq],
                [t.pcapAckNum, pkt.tcpAck],
                [t.pcapHeaderLen, `${pkt.tcpHdrLen} bytes`],
                [t.flags, flagStr],
                [t.pcapWindowSize, pkt.tcpWindow],
                [t.checksum, pkt.tcpChecksum],
                [t.pcapUrgentPtr, pkt.tcpUrgPtr],
              ]} />
            )}
            {pkt.tcpContinuation && pkt.reassemblyHead != null && (
              <div className="pd-reassembly-note">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M8 1v14M1 8h14" stroke="#79c0ff" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                {t.pcapReassembledInto(pkt.reassemblyHead + 1)}
              </div>
            )}
            {pkt.reassembledSegments && pkt.reassembledSegments.length > 1 && (
              <LayerSection title={t.pcapReassembledSegs(pkt.reassembledTotalBytes)} color="#79c0ff" defaultOpen={true}>
                {pkt.reassembledSegments.map((seg, i) => (
                  <div className="pd-field" key={seg.pktIndex}>
                    <span className="pd-field-key">#{i + 1}</span>
                    <span className="pd-field-val">
                      Frame {seg.pktIndex + 1} &nbsp;
                      <span style={{ color: '#8b949e' }}>({seg.len} bytes)</span>
                    </span>
                  </div>
                ))}
              </LayerSection>
            )}
            {pkt.http && <HttpSection http={pkt.http} />}
            {!pkt.http && pkt.payload && pkt.payload.length > 0 && (
              <LayerSection title={t.pcapPayload} color="#8b949e" defaultOpen={false}>
                <pre className="pd-body-pre">{pkt.payloadAscii}</pre>
              </LayerSection>
            )}
            <LayerSection title={t.pcapRawHex} color="#444c56" defaultOpen={false}>
              <pre className="pd-hex-dump">{hexDump(pkt.rawHex)}</pre>
            </LayerSection>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PcapAnalyzer() {
  const t = useT();
  const [pcapId, setPcapId] = useState(null);
  const [total, setTotal] = useState(0);
  const [packets, setPackets] = useState([]);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [filterInput, setFilterInput] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [pairedIndex, setPairedIndex] = useState(null);
  const [modalPkt, setModalPkt] = useState(null);
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [colorRows, setColorRows] = useState(true);
  const [showOnvif, setShowOnvif] = useState(false);
  const [onvifData, setOnvifData] = useState(null);
  const [onvifExpanded, setOnvifExpanded] = useState(null);
  const [onvifErrorOnly, setOnvifErrorOnly] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [pageSize, setPageSize] = useState(100);
  const [onvifPage, setOnvifPage] = useState(1);
  const fileInputRef = useRef(null);
  const pcapIdRef = useRef(null);

  useEffect(() => { pcapIdRef.current = pcapId; }, [pcapId]);

  useEffect(() => {
    function onCacheCleared() {
      resetState();
    }
    window.addEventListener('nt-cache-cleared', onCacheCleared);
    return () => window.removeEventListener('nt-cache-cleared', onCacheCleared);
  }, []);

  async function deleteCurrent(id) {
    if (!id) return;
    await axios.delete(`/api/pcap/${id}`).catch(() => {});
  }

  function resetState() {
    setPcapId(null); setTotal(0); setPackets([]); setFilteredTotal(0);
    setFilter(''); setFilterInput(''); setPage(1); setSelected(null);
    setPairedIndex(null); setModalPkt(null); setStats(null);
    setTimeline([]); setOnvifData(null); setOnvifExpanded(null);
    setOnvifErrorOnly(false);
  }

  async function handleClose() {
    await deleteCurrent(pcapId);
    resetState();
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    // Release previous PCAP before loading new one
    await deleteCurrent(pcapId);
    resetState();
    setLoading(true); setError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await axios.post('/api/pcap/upload', fd);
      setPcapId(data.pcapId);
      setTotal(data.total);
      setPage(1);
      await loadPackets(data.pcapId, '', 1);
      await loadStats(data.pcapId, '');
      await loadTimeline(data.pcapId, '');
      const { data: od } = await axios.get(`/api/pcap/${data.pcapId}/onvif`);
      setOnvifData(od.interactions);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPackets(id, f, p) {
    const { data } = await axios.get(`/api/pcap/${id}/packets`, {
      params: { filter: f, page: p, limit: pageSize },
    });
    setPackets(data.packets);
    setFilteredTotal(data.total);
  }

  async function loadStats(id, f) {
    const { data } = await axios.get(`/api/pcap/${id}/stats`, { params: { filter: f } });
    setStats(data);
  }

  async function loadTimeline(id, f) {
    const { data } = await axios.get(`/api/pcap/${id}/timeline`, { params: { filter: f } });
    setTimeline(data.timeline);
  }

  async function applyFilter() {
    if (!pcapId) return;
    setLoading(true);
    setFilter(filterInput);
    setPage(1);
    try {
      await Promise.all([
        loadPackets(pcapId, filterInput, 1),
        loadStats(pcapId, filterInput),
        loadTimeline(pcapId, filterInput),
      ]);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function changePage(p) {
    if (!pcapId) return;
    setPage(p);
    await loadPackets(pcapId, filter, p);
  }

  function selectPacket(pkt) {
    setSelected(pkt.pktIndex ?? pkt.index);
    setPairedIndex(pkt.httpPairIndex ?? null);
  }

  async function openDetail(pkt) {
    const { data } = await axios.get(`/api/pcap/${pcapId}/packet/${pkt.pktIndex ?? pkt.index}`);
    setModalPkt(data);
  }

  const totalPages = Math.ceil(filteredTotal / pageSize);
  const pieData = stats
    ? Object.entries(stats.byProtocol).map(([name, value]) => ({ name, value }))
    : [];

  function rowClass(p) {
    const idx = p.pktIndex ?? p.index;
    const classes = [];
    if (idx === selected) classes.push('selected');
    else if (idx === pairedIndex) classes.push('http-paired');
    if (p.tcpContinuation) classes.push('tcp-continuation');
    if (p.tcpAnomaly) classes.push('tcp-anomaly');
    if (colorRows) classes.push(protoClass(p.protocol), 'row-colored');
    return classes.join(' ');
  }

  return (
    <div className="pcap-analyzer">
      <div className="pcap-toolbar">
        <button className="btn-primary" onClick={() => fileInputRef.current.click()}>
          {t.pcapOpen}
        </button>
        <input ref={fileInputRef} type="file" accept=".pcap,.pcapng" style={{ display: 'none' }} onChange={handleUpload} />
        {pcapId && (
          <>
            <input
              placeholder={t.pcapFilterPlaceholder}
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
            />
            <button className="btn-primary" onClick={applyFilter}>{t.apply}</button>
            {filter && (
              <button className="btn-secondary" onClick={() => {
                setFilterInput(''); setFilter('');
                loadPackets(pcapId, '', 1); loadStats(pcapId, ''); loadTimeline(pcapId, ''); setPage(1);
              }}>{t.clear}</button>
            )}
            <span className="pcap-info">{t.pcapPackets(filteredTotal, total)}</span>
            <select
              className="pcap-pagesize-select"
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); loadPackets(pcapId, filter, 1); }}
            >
              {[50, 100, 200, 500].map(n => <option key={n} value={n}>{t.pcapPerPage(n)}</option>)}
            </select>
            <label className="api-opt-check">
              <input type="checkbox" checked={colorRows} onChange={e => setColorRows(e.target.checked)} />
              <span className="api-opt-check-label">{t.pcapColorRows}</span>
            </label>
            {onvifData && onvifData.length > 0 && (
              <label className="api-opt-check">
                <input type="checkbox" checked={showOnvif} onChange={e => setShowOnvif(e.target.checked)} />
                <span className="api-opt-check-label">
                  <span className="proto-tag proto-onvif" style={{ marginRight: 4 }}>ONVIF</span>
                  {t.pcapOnvifAnalysis}
                </span>
              </label>
            )}
            {showOnvif && (
              <label className="api-opt-check">
                <input type="checkbox" checked={onvifErrorOnly} onChange={e => setOnvifErrorOnly(e.target.checked)} />
                <span className="api-opt-check-label">{t.pcapErrorsOnly}</span>
              </label>
            )}
          </>
        )}
        {pcapId && (
          <button className="btn-danger" style={{ marginLeft: 'auto' }} onClick={handleClose}>
            {t.pcapClose}
          </button>
        )}
        {error && <span className="inline-error">{error}</span>}
      </div>

      {!pcapId && !loading && (
        <div className="pcap-empty">
          <svg className="pcap-empty-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h4l4-12 6 24 4-16 4 8 4-4h6"/>
          </svg>
          <p>{t.pcapEmpty}</p>
        </div>
      )}

      {loading && (
        <div className="pcap-empty"><div>{t.pcapParsing}</div></div>
      )}

      {pcapId && !loading && (
        <div className="pcap-body">
          <div className="pcap-left">
            {showOnvif && onvifData ? (() => {
              const ONVIF_PAGE_SIZE = 100;
              const filteredOnvif = onvifErrorOnly ? onvifData.filter(ix => ix.isError) : onvifData;
              const onvifTotalPages = Math.ceil(filteredOnvif.length / ONVIF_PAGE_SIZE);
              const onvifSlice = filteredOnvif.slice((onvifPage - 1) * ONVIF_PAGE_SIZE, onvifPage * ONVIF_PAGE_SIZE);
              return (
                <>
                  <div className="packet-table-wrap">
                    <table className="onvif-table">
                      <thead>
                        <tr>
                          <th className="pkt-arrow-col"></th>
                          <th>#</th><th>Time</th><th>{t.pcapSrcDst}</th><th>{t.pcapAction}</th><th>{t.pcapStatus}</th><th>{t.pcapError}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {onvifSlice.map((ix, i) => {
                          const absI = (onvifPage - 1) * ONVIF_PAGE_SIZE + i;
                          const reqKey = `r${absI}`;
                          const respKey = `s${absI}`;
                          const isReqExpanded = onvifExpanded === reqKey;
                          const isRespExpanded = onvifExpanded === respKey;
                          const bothSelected = onvifExpanded === reqKey || onvifExpanded === respKey;
                          return (
                        <>
                          <tr key={reqKey} className={`onvif-row${bothSelected ? ' onvif-expanded' : ''}`}
                            onClick={() => setOnvifExpanded(isReqExpanded ? null : reqKey)}>
                            <td className="pkt-arrow-col"><span className="pkt-pair-arrow">→</span></td>
                            <td className="mono">{i + 1}-req</td>
                            <td className="mono">{ix.ts.toFixed(3)}</td>
                            <td className="mono">{ix.src} → {ix.dst}</td>
                            <td className="onvif-action">{ix.action ?? ix.url ?? '-'}</td>
                            <td className="mono">{ix.method ?? '-'}</td>
                            <td></td>
                          </tr>
                          <tr key={`${reqKey}-d`} className={`onvif-detail-row${isReqExpanded ? ' open' : ''}`}>
                            <td colSpan={7}>
                              <div className="onvif-detail-wrap"><div className="onvif-detail-inner"><div className="onvif-detail">
                                <div className="onvif-detail-line"><span>URL:</span> {ix.url}</div>
                                {ix.reqBody && <XmlTree xml={ix.reqBody} />}
                              </div></div></div>
                            </td>
                          </tr>
                          {ix.respTs != null && (
                            <tr key={respKey}
                              className={`onvif-row${ix.isError ? ' onvif-error' : ''}${bothSelected ? ' onvif-expanded' : ''}`}
                              onClick={() => setOnvifExpanded(isRespExpanded ? null : respKey)}>
                              <td className="pkt-arrow-col"><span className="pkt-pair-arrow">←</span></td>
                              <td className="mono">{i + 1}-resp</td>
                              <td className="mono">{ix.respTs.toFixed(3)}</td>
                              <td className="mono">{ix.dst} → {ix.src}</td>
                              <td className="onvif-action">{t.pcapRtt(((ix.respTs - ix.ts) * 1000).toFixed(1))}</td>
                              <td className={`mono${ix.status >= 400 ? ' onvif-status-err' : ''}`}>
                                {ix.status != null ? `${ix.status} ${ix.statusText || ''}` : '—'}
                              </td>
                              <td>
                                {ix.hasSoapFault && <span className="onvif-fault-badge">{t.pcapSoapFault}</span>}
                                {!ix.hasSoapFault && ix.status >= 400 && <span className="onvif-fault-badge">HTTP {ix.status}</span>}
                              </td>
                            </tr>
                          )}
                          {ix.respTs != null && (
                            <tr key={`${respKey}-d`} className={`onvif-detail-row${isRespExpanded ? ' open' : ''}`}>
                              <td colSpan={7}>
                                <div className="onvif-detail-wrap"><div className="onvif-detail-inner"><div className="onvif-detail">
                                  {ix.respBody && <XmlTree xml={ix.respBody} />}
                                </div></div></div>
                              </td>
                            </tr>
                          )}
                          <tr key={`sep${i}`} className="onvif-sep"><td colSpan={7}></td></tr>
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <button className="btn-secondary" disabled={onvifPage <= 1} onClick={() => setOnvifPage(p => p - 1)}>‹ {t.prev}</button>
                <span>{t.pcapPage(onvifPage, onvifTotalPages || 1)}</span>
                <button className="btn-secondary" disabled={onvifPage >= onvifTotalPages} onClick={() => setOnvifPage(p => p + 1)}>{t.next} ›</button>
              </div>
            </>
            );
          })() : (
              <>
                <div className="packet-table-wrap">
                  <table className="packet-table">
                    <thead>
                      <tr>
                        <th className="pkt-arrow-col"></th>
                        <th>#</th><th>Time</th><th>{t.protocol}</th>
                        <th>{t.pcapSrc}</th><th>{t.pcapDst}</th><th>{t.pcapLen}</th><th>{t.pcapInfo}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packets.map((p) => (
                        <tr
                          key={p.pktIndex ?? p.index}
                          className={rowClass(p)}
                          onClick={() => selectPacket(p)}
                          onDoubleClick={() => openDetail(p)}
                          title={t.pcapDblClick}
                        >
                          <td className="pkt-arrow-col">
                            {p.httpPairIndex != null && (p.pktIndex === selected || p.pktIndex === pairedIndex) && (
                              <span className="pkt-pair-arrow">
                                {p.httpKind === 'request' ? '\u2192' : '\u2190'}
                              </span>
                            )}
                          </td>
                          <td className="mono">{(p.pktIndex ?? p.index) + 1}</td>
                          <td className="mono">{p.ts.toFixed(6)}</td>
                          <td><span className={`proto-tag ${protoClass(p.protocol)}`}>{p.protocol}</span>{p.isOnvif && <span className="proto-tag proto-onvif">ONVIF</span>}</td>
                          <td className="mono">{p.srcIP ? `${p.srcIP}${p.srcPort ? ':' + p.srcPort : ''}` : '-'}</td>
                          <td className="mono">{p.dstIP ? `${p.dstIP}${p.dstPort ? ':' + p.dstPort : ''}` : '-'}</td>
                          <td className="mono">{p.len}</td>
                          <td className="mono pkt-info">
                            {p.tcpAnomaly && <span className="tcp-anomaly-badge">{p.tcpAnomaly}</span>}
                            {p.summary}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <button className="btn-secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>‹ {t.prev}</button>
                  <span>{t.pcapPage(page, totalPages || 1)}</span>
                  <button className="btn-secondary" disabled={page >= totalPages} onClick={() => changePage(page + 1)}>{t.next} ›</button>
                </div>
              </>
            )}
          </div>

          {rightCollapsed ? (
            <div className="pcap-right-edge-zone">
              <button className="pcap-right-toggle" onClick={() => setRightCollapsed(false)} title={t.expand}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2L4 6l4 4"/>
                </svg>
              </button>
            </div>
          ) : null}
          <div className={`pcap-right${rightCollapsed ? ' pcap-right-collapsed' : ''}`}>
            <button className="pcap-right-toggle" onClick={() => setRightCollapsed(true)} title={t.collapse}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 2l4 4-4 4"/>
              </svg>
            </button>
            <div className="pcap-right-scroll">
            {timeline.length > 0 && (
              <div className="chart-box">
                <h4>{t.pcapTrafficChart}</h4>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={timeline}>
                    <XAxis dataKey="t" hide />
                    <YAxis width={40} tick={{ fontSize: 10, fill: '#8b949e' }} />
                    <Tooltip
                      contentStyle={{ background: '#0d1117', border: '1px solid #21262d', fontSize: 11 }}
                      formatter={(v) => [`${v} B`, 'bytes']}
                      labelFormatter={() => ''}
                    />
                    <Line type="monotone" dataKey="bytes" stroke="#58a6ff" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {pieData.length > 0 && (
              <div className="chart-box">
                <h4>{t.pcapProtoDist}</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={58}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false} fontSize={10}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={protoColor(entry.name)} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#0d1117', border: '1px solid #21262d', fontSize: 11 }}
                      itemStyle={{ color: '#c9d1d9' }}
                      formatter={(v, name) => [v, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {stats && (
              <div className="chart-box">
                <h4>{t.pcapStats}</h4>
                <table className="stats-table">
                  <tbody>
                    {Object.entries(stats.byProtocol).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                      <tr key={k}>
                        <td><span className={`proto-tag ${protoClass(k)}`}>{k}</span></td>
                        <td>{v}</td>
                        <td>{((v / stats.total) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {modalPkt && <PacketDetailModal pkt={modalPkt} onClose={() => setModalPkt(null)} />}
    </div>
  );
}
