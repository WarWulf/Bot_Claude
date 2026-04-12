import { useEffect, useMemo, useState, useCallback } from 'react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const C = {
  bg: '#0a0e17', card: '#111827', border: '#1e293b',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', purple: '#8b5cf6', cyan: '#06b6d4',
  text: '#e2e8f0', muted: '#64748b', dim: '#334155',
};

function fmt(v, d = 2) { const n = Number(v); return Number.isNaN(n) ? '-' : n.toFixed(d); }
function pct(v) { return `${fmt(Number(v) * 100, 1)}%`; }

function Metric({ label, value, unit = '', target, good }) {
  const ok = good !== undefined ? good : true;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', flex: '1 1 130px', minWidth: 130 }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, fontFamily: 'JetBrains Mono, monospace' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: ok ? C.green : C.red, marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>{value}{unit}</div>
      {target && <div style={{ fontSize: 9, color: C.dim, marginTop: 1, fontFamily: 'JetBrains Mono, monospace' }}>target: {target}</div>}
    </div>
  );
}

function Gauge({ label, value, max, warning }) {
  const p = Math.min((value / max) * 100, 100);
  const danger = value >= max * 0.95;
  const warn = value >= warning;
  const color = danger ? C.red : warn ? C.amber : C.green;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 3, fontFamily: 'JetBrains Mono, monospace' }}>
        <span>{label}</span><span style={{ color }}>{fmt(value * 100, 1)}% / {fmt(max * 100, 0)}%</span>
      </div>
      <div style={{ height: 5, background: C.dim, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: `${(warning / max) * 100}%`, top: 0, bottom: 0, width: 2, background: C.amber, opacity: 0.5, zIndex: 2 }} />
        <div style={{ height: '100%', width: `${p}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

function Pill({ ok, label }) {
  const bg = ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
  const color = ok ? C.green : C.red;
  return <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 16, background: bg, color, fontFamily: 'JetBrains Mono, monospace', border: `1px solid ${color}22` }}>{label}</span>;
}

function Btn({ children, onClick, disabled, variant, busy }) {
  const accent = variant === 'danger' ? C.red : variant === 'warn' ? C.amber : C.cyan;
  return (
    <button onClick={onClick} disabled={disabled || busy} style={{
      padding: '7px 16px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', background: disabled ? C.dim : `${accent}18`,
      color: disabled ? C.muted : accent, border: `1px solid ${disabled ? C.dim : accent}44`, borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: busy ? 0.6 : 1, transition: 'all 0.15s'
    }}>{busy ? '...' : children}</button>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
      <div style={{ color: C.muted }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color || C.text }}>{p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</div>)}
    </div>
  );
}

const TABS = ['overview', 'scan', 'research', 'predict', 'risk', 'settings', 'ops'];
const TAB_LABELS = { overview: 'Overview', scan: 'Scan & Märkte', research: 'Research', predict: 'Predict', risk: 'Risk & Trades', settings: 'Einstellungen', ops: 'Ops' };

export default function App() {
  const [tab, setTab] = useState('overview');
  const [state, setState] = useState(null);
  const [scan, setScan] = useState({ markets: [], runs: [] });
  const [auth, setAuth] = useState(null);
  const [health, setHealth] = useState(null);
  const [scanStatus, setScanStatus] = useState(null);
  const [steps, setSteps] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [improvements, setImprovements] = useState(null);
  const [liveLog, setLiveLog] = useState([]);
  const [connTest, setConnTest] = useState(null);
  const [predictStatus, setPredictStatus] = useState(null);
  const [calibration, setCalibration] = useState(null);
  const [researchStatus, setResearchStatus] = useState(null);
  const [execStatus, setExecStatus] = useState(null);
  const [riskStatus, setRiskStatus] = useState(null);
  const [busy, setBusy] = useState({});
  const [msg, setMsg] = useState('');
  const [uiAuthed, setUiAuthed] = useState(false);
  const [uiPw, setUiPw] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [saving, setSaving] = useState(false);

  const apiFetch = useCallback(async (path, opts = {}) => {
    const h = { ...(opts.headers || {}) };
    if (uiPw) h['x-ui-password'] = uiPw;
    return fetch(path, { ...opts, headers: h });
  }, [uiPw]);

  const apiJson = useCallback(async (path, fallback = null) => {
    try { const r = await apiFetch(path); if (!r.ok) throw 0; return await r.json(); } catch { return fallback; }
  }, [apiFetch]);

  const reload = useCallback(async () => {
    const [st, sc, au, he, ss, stp, pip, imp, ps, cal, rs, es, rsk] = await Promise.all([
      apiJson('/api/state'), apiJson('/api/scan', { markets: [], runs: [] }), apiJson('/api/auth/status'),
      apiJson('/api/health'), apiJson('/api/scan/status'), apiJson('/api/status/steps'),
      apiJson('/api/pipeline/status'), apiJson('/api/improvements'),
      apiJson('/api/predict/status'), apiJson('/api/predict/calibration'),
      apiJson('/api/research/status'), apiJson('/api/execute/status'), apiJson('/api/risk/status')
    ]);
    if (st) setState(st);
    setScan(sc || { markets: [], runs: [] }); setAuth(au); setHealth(he);
    setScanStatus(ss); setSteps(stp); setPipeline(pip); setImprovements(imp);
    setPredictStatus(ps); setCalibration(cal); setResearchStatus(rs);
    setExecStatus(es); setRiskStatus(rsk);
  }, [apiJson]);

  async function doLogin() {
    try {
      const r = await fetch('/api/ui-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwInput }) });
      if (!r.ok) throw new Error('Falsches Passwort');
      localStorage.setItem('ui_pw', pwInput); setUiPw(pwInput); setPwInput(''); setUiAuthed(true);
    } catch (e) { setMsg(e.message); }
  }

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/ui-auth/status'); const p = await r.json();
      if (!p.enabled) { setUiAuthed(true); return; }
      const saved = localStorage.getItem('ui_pw') || '';
      if (!saved) return;
      const lr = await fetch('/api/ui-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: saved }) });
      if (lr.ok) { setUiPw(saved); setUiAuthed(true); }
      else localStorage.removeItem('ui_pw');
    })();
  }, []);

  useEffect(() => { if (uiAuthed) reload(); }, [uiAuthed, reload]);
  useEffect(() => {
    if (!uiAuthed || tab !== 'ops') return;
    const t = setInterval(async () => { const d = await apiJson('/api/scan/live-log', { items: [] }); setLiveLog(d?.items || []); }, 4000);
    return () => clearInterval(t);
  }, [tab, uiAuthed, apiJson]);

  async function act(key, fn, okMsg) {
    setBusy(p => ({ ...p, [key]: true }));
    try { await fn(); if (okMsg) setMsg(okMsg); await reload(); } catch (e) { setMsg(`Fehler: ${e.message}`); }
    finally { setBusy(p => ({ ...p, [key]: false })); }
  }

  async function save() {
    setSaving(true);
    try { await apiFetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: state.config, providers: state.providers }) }); setMsg('Gespeichert'); await reload(); }
    catch (e) { setMsg(e.message); } finally { setSaving(false); }
  }

  function setConfig(k, v) { setState(p => ({ ...p, config: { ...p.config, [k]: v } })); }
  function setProvider(name, k, v) { setState(p => ({ ...p, providers: { ...p.providers, [name]: { ...(p.providers?.[name] || {}), [k]: v } } })); }

  const cfg = state?.config || {};
  const bankroll = Number(cfg.bankroll || 1000);
  const trades = state?.trades || [];
  const openTrades = trades.filter(t => t.status === 'OPEN');
  const closedTrades = trades.filter(t => t.status !== 'OPEN' && t.netPnlUsd !== undefined);
  const totalPnl = closedTrades.reduce((s, t) => s + Number(t.netPnlUsd || 0), 0);
  const openExposure = openTrades.reduce((s, t) => s + Number(t.positionUsd || 0), 0);
  const predictions = predictStatus?.predictions || [];
  const briefs = researchStatus?.briefs || [];
  const markets = scan?.markets || [];

  const equityData = useMemo(() => {
    if (!closedTrades.length) return [{ i: 0, v: bankroll }];
    let cum = 0;
    return [{ i: 0, v: bankroll }, ...closedTrades.map((t, i) => { cum += Number(t.netPnlUsd || 0); return { i: i + 1, v: bankroll + cum }; })];
  }, [closedTrades, bankroll]);

  const pnlData = useMemo(() => closedTrades.slice(0, 30).map((t, i) => ({ i, pnl: Number(t.netPnlUsd || 0), name: (t.title || '').slice(0, 20) })), [closedTrades]);

  const tabS = (t) => ({
    padding: '7px 16px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: 0.8,
    background: tab === t ? C.blue : 'transparent', color: tab === t ? '#fff' : C.muted,
    border: 'none', borderRadius: 5, cursor: 'pointer', transition: 'all 0.15s'
  });

  if (!uiAuthed) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 32, width: 340, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}><span style={{ color: C.cyan }}>&#9670;</span></div>
        <h2 style={{ color: C.text, fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Prediction Market Bot</h2>
        <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Dashboard Login</p>
        <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && doLogin()}
          placeholder="Passwort" style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, marginBottom: 12, fontFamily: 'JetBrains Mono, monospace', boxSizing: 'border-box' }} />
        <button onClick={doLogin} style={{ width: '100%', padding: '10px', borderRadius: 6, border: 'none', background: C.cyan, color: '#000', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Login</button>
        {msg && <p style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{msg}</p>}
      </div>
    </div>
  );

  if (!state) return <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>Lade...</div>;

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'IBM Plex Sans, -apple-system, sans-serif', padding: '20px 16px' }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}><span style={{ color: C.cyan }}>&#9670;</span> Prediction Market Bot</h1>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
            {markets.length} märkte &middot; {openTrades.length} offen &middot; ${fmt(bankroll + totalPnl, 0)} bankroll
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
            background: health?.status === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${health?.status === 'ok' ? C.green : C.red}33`, borderRadius: 16,
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: health?.status === 'ok' ? C.green : C.red
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', animation: 'pulse 2s infinite' }} />
            {cfg.kill_switch ? 'KILL SWITCH' : health?.status === 'ok' ? (cfg.paper_mode ? 'PAPER MODE' : 'LIVE') : 'OFFLINE'}
          </div>
          <Btn onClick={() => reload()}>Refresh</Btn>
          <Btn onClick={save} busy={saving}>Save</Btn>
        </div>
      </div>

      {msg && <div style={{ fontSize: 12, color: C.cyan, marginBottom: 10, fontFamily: 'JetBrains Mono, monospace', padding: '6px 10px', background: `${C.cyan}0a`, borderRadius: 6, border: `1px solid ${C.cyan}22` }}>{msg}</div>}

      {/* Pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <Pill ok={health?.status === 'ok'} label={`Backend: ${health?.status || '?'}`} />
        <Pill ok={auth?.polymarket?.configured} label={`Polymarket: ${auth?.polymarket?.configured ? 'ok' : 'fehlt'}`} />
        <Pill ok={auth?.kalshi?.configured} label={`Kalshi: ${auth?.kalshi?.configured ? 'ok' : 'fehlt'}`} />
        {['openai', 'claude', 'gemini', 'ollama_cloud'].filter(n => auth?.[n]?.configured).map(n =>
          <Pill key={n} ok={true} label={`${n}: ok`} />
        )}
      </div>

      {/* Action Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <Btn onClick={() => act('scan', async () => { const r = await apiFetch('/api/scan/run', { method: 'POST' }); const p = await r.json(); if (!p.ok) throw new Error(p.message); setMsg(`Scan: ${p.tradeable_count} tradeable`); })} busy={busy.scan}>Scan</Btn>
        <Btn onClick={() => act('research', async () => { const r = await apiFetch('/api/research/run', { method: 'POST' }); const p = await r.json(); if (!p.ok) throw new Error(p.message); })} busy={busy.research}>Research</Btn>
        <Btn onClick={() => act('predict', async () => { const r = await apiFetch('/api/predict/run', { method: 'POST' }); const p = await r.json(); if (!p.ok) throw new Error(p.message); })} busy={busy.predict}>Predict</Btn>
        <Btn onClick={() => act('execute', async () => { const r = await apiFetch('/api/execute/run', { method: 'POST' }); const p = await r.json(); if (!p.ok) throw new Error(p.message); })} busy={busy.execute}>Execute</Btn>
        <Btn onClick={() => act('risk', async () => { const r = await apiFetch('/api/risk/run', { method: 'POST' }); const p = await r.json(); if (!p.ok) throw new Error(p.message); })} busy={busy.risk}>Risk</Btn>
        <Btn onClick={() => act('pipeline', async () => { const r = await apiFetch('/api/pipeline/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const p = await r.json(); if (!p.ok) throw new Error(p.message); setMsg('Pipeline fertig'); })} busy={busy.pipeline}>Full Pipeline</Btn>
        <Btn variant={cfg.kill_switch ? 'danger' : 'warn'} onClick={() => act('kill', async () => {
          await apiFetch('/api/kill-switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !cfg.kill_switch }) });
        })}>{cfg.kill_switch ? 'Kill Switch AUS' : 'Kill Switch'}</Btn>
      </div>

      {/* Step Progress */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5].map(n => {
            const v = Number(steps?.[`step${n}`]?.progress_pct || 0);
            const labels = ['Scan', 'Research', 'Predict', 'Execute', 'Risk'];
            return (
              <div key={n} style={{ flex: '1 1 100px', minWidth: 100 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, marginBottom: 3, fontFamily: 'JetBrains Mono, monospace' }}>
                  <span>Step {n} {labels[n - 1]}</span><span>{fmt(v, 0)}%</span>
                </div>
                <div style={{ height: 4, background: C.dim, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${v}%`, background: v >= 100 ? C.green : v > 0 ? C.amber : C.dim, borderRadius: 2, transition: 'width 0.4s' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 16, background: C.card, padding: 3, borderRadius: 7, width: 'fit-content', flexWrap: 'wrap' }}>
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} style={tabS(t)}>{TAB_LABELS[t]}</button>)}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (<div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <Metric label="Bankroll" value={`$${fmt(bankroll + totalPnl, 0)}`} good={totalPnl >= 0} />
          <Metric label="P&L" value={`${totalPnl >= 0 ? '+' : ''}$${fmt(totalPnl, 0)}`} good={totalPnl >= 0} />
          <Metric label="Open Positions" value={openTrades.length} target="max 15" good={openTrades.length <= 15} />
          <Metric label="Exposure" value={`$${fmt(openExposure, 0)}`} good={bankroll > 0 ? openExposure / bankroll < 0.5 : true} />
          <Metric label="Paper Mode" value={cfg.paper_mode ? 'ON' : 'OFF'} good={true} />
        </div>
        {equityData.length > 1 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Equity curve</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={equityData}>
                <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.cyan} stopOpacity={0.3} /><stop offset="100%" stopColor={C.cyan} stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="i" tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<ChartTip />} /><Area type="monotone" dataKey="v" stroke={C.cyan} fill="url(#eq)" strokeWidth={2} name="equity" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {pnlData.length > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Trade P&L</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={pnlData}>
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="pnl" name="pnl" radius={[3, 3, 0, 0]}>{pnlData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? C.green : C.red} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>)}

      {/* SCAN */}
      {tab === 'scan' && (<div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Metric label="Märkte gesamt" value={state?.scanner_health?.total || 0} />
          <Metric label="Tradeable" value={markets.length} />
          <Metric label="Scan Duration" value={`${fmt(scanStatus?.runtime?.lastDurationMs || 0, 0)}ms`} />
          <Metric label="Polymarket" value={scanStatus?.runtime?.lastCoverage?.polymarket || 0} />
          <Metric label="Kalshi" value={scanStatus?.runtime?.lastCoverage?.kalshi || 0} />
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Top tradeable markets</div>
          {markets.slice(0, 15).map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < markets.length - 1 ? `1px solid ${C.border}11` : 'none' }}>
              <div style={{ flex: 1, fontSize: 13 }}>{m.question || m.market}</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 11, color: C.muted, fontFamily: 'JetBrains Mono, monospace', alignItems: 'center' }}>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: m.platform === 'kalshi' ? `${C.purple}20` : `${C.cyan}20`, color: m.platform === 'kalshi' ? C.purple : C.cyan }}>{m.platform}</span>
                <span>P: {fmt(m.market_price, 2)}</span>
                <span>V: {Number(m.volume || 0).toLocaleString()}</span>
                <span>Score: {fmt(m.opportunity_score, 0)}</span>
                {(m.anomaly_flags || []).length > 0 && <span style={{ color: C.amber }}>&#9888;</span>}
              </div>
            </div>
          ))}
          {!markets.length && <div style={{ color: C.muted, fontSize: 13, padding: 10 }}>Noch keine Scan-Ergebnisse. Klicke "Scan" oben.</div>}
        </div>
      </div>)}

      {/* RESEARCH */}
      {tab === 'research' && (<div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Metric label="Briefs" value={briefs.length} />
          <Metric label="Coverage" value={`${fmt(researchStatus?.summary?.coverage_pct || 0, 0)}%`} target="hoch" good={Number(researchStatus?.summary?.coverage_pct || 0) > 50} />
          <Metric label="Avg Confidence" value={fmt(researchStatus?.summary?.avg_confidence || 0, 3)} />
          <Metric label="Source Diversity" value={researchStatus?.summary?.source_diversity || 0} />
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Research briefs</div>
          {briefs.map((b, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: `1px solid ${C.border}11` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13 }}>{b.question}</span>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: b.sentiment === 'bullish' ? C.green : b.sentiment === 'bearish' ? C.red : C.muted }}>{b.sentiment}</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
                confidence: {fmt(b.confidence, 3)} &middot; gap: {fmt(b.consensus_vs_market_gap, 3)} &middot; stance: {b.stance} &middot; sources: {(b.sources || []).length}
              </div>
              {b.thesis && <div style={{ fontSize: 12, color: C.dim, marginTop: 2, fontStyle: 'italic' }}>{b.thesis}</div>}
            </div>
          ))}
          {!briefs.length && <div style={{ color: C.muted, fontSize: 13, padding: 10 }}>Noch keine Research-Briefs. Starte zuerst einen Scan, dann Research.</div>}
        </div>
      </div>)}

      {/* PREDICT */}
      {tab === 'predict' && (<div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Metric label="Predictions" value={predictions.length} />
          <Metric label="Avg Edge" value={fmt(predictStatus?.summary?.avg_edge || 0, 4)} />
          <Metric label="Actionable" value={`${fmt(predictStatus?.summary?.actionable_pct || 0, 0)}%`} />
          <Metric label="Brier Score" value={fmt(calibration?.brier_score ?? predictStatus?.summary?.calibration_brier_score, 4)} target="< 0.25" good={Number(calibration?.brier_score ?? 1) < 0.25} />
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Predictions</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
              <thead><tr style={{ color: C.muted, textAlign: 'left' }}>
                {['Market', 'Mkt P', 'Model P', 'Edge', 'EV', 'Conf', 'Dir'].map(h => <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, fontWeight: 500 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {predictions.slice(0, 20).map((p, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}11` }}>
                    <td style={{ padding: '6px 8px', color: C.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.question}</td>
                    <td style={{ padding: '6px 8px' }}>{fmt(p.market_prob, 2)}</td>
                    <td style={{ padding: '6px 8px' }}>{fmt(p.model_prob, 2)}</td>
                    <td style={{ padding: '6px 8px', color: Number(p.edge) > 0 ? C.green : C.red }}>{fmt(p.edge, 4)}</td>
                    <td style={{ padding: '6px 8px' }}>{fmt(p.expected_value, 3)}</td>
                    <td style={{ padding: '6px 8px' }}>{fmt(p.confidence, 2)}</td>
                    <td style={{ padding: '6px 8px', color: p.direction === 'BUY_YES' ? C.green : p.direction === 'BUY_NO' ? C.red : C.muted, fontWeight: 600 }}>{p.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!predictions.length && <div style={{ color: C.muted, fontSize: 13, padding: 10 }}>Noch keine Predictions. Starte Scan → Research → Predict.</div>}
        </div>
        {(calibration?.outcomes || []).length > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Calibration</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Brier Score: {fmt(calibration?.brier_score, 4)} &middot; Samples: {calibration?.samples || 0}</div>
          </div>
        )}
      </div>)}

      {/* RISK & TRADES */}
      {tab === 'risk' && (<div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Risk gauges</div>
          <Gauge label="Drawdown" value={Number(state?.risk?.drawdown_pct || 0)} max={0.08} warning={0.05} />
          <Gauge label="Exposure" value={bankroll > 0 ? openExposure / bankroll : 0} max={Number(cfg.max_total_exposure_pct || 0.5)} warning={Number(cfg.max_total_exposure_pct || 0.5) * 0.7} />
          <Gauge label="Positions" value={openTrades.length / Number(cfg.max_concurrent_positions || 15)} max={1} warning={0.8} />
          <Gauge label="Daily Loss" value={Number(state?.risk?.daily_realized_pnl || 0) < 0 ? Math.abs(Number(state?.risk?.daily_realized_pnl || 0)) / bankroll : 0} max={Number(cfg.daily_loss_limit_pct || 0.15)} warning={0.1} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Metric label="Kelly Fraction" value={`${fmt(Number(cfg.kelly_fraction || 0.25) * 100, 0)}%`} />
          <Metric label="Max Pos %" value={`${fmt(Number(cfg.max_pos_pct || 0.05) * 100, 0)}%`} />
          <Metric label="Risk Violations" value={riskStatus?.summary?.violations || 0} good={Number(riskStatus?.summary?.violations || 0) === 0} />
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Open positions ({openTrades.length})</div>
          {openTrades.map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}11`, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ color: C.text }}>{t.title || t.market_id}</span>
              <div style={{ display: 'flex', gap: 10, color: C.muted }}>
                <span style={{ color: t.direction === 'BUY_YES' ? C.green : C.red }}>{t.direction}</span>
                <span>${fmt(t.positionUsd, 0)}</span>
              </div>
            </div>
          ))}
          {!openTrades.length && <div style={{ color: C.muted, fontSize: 13 }}>Keine offenen Positionen.</div>}
        </div>
      </div>)}

      {/* SETTINGS */}
      {tab === 'settings' && (<div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {/* General */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Allgemein</div>
            {[['bankroll', 'Bankroll ($)'], ['top_n', 'Top N'], ['kelly_fraction', 'Kelly Fraction'], ['min_edge', 'Min Edge'], ['max_pos_pct', 'Max Pos %'], ['max_total_exposure_pct', 'Max Exposure %'], ['max_concurrent_positions', 'Max Positions'], ['max_drawdown_pct', 'Max Drawdown'], ['daily_loss_limit_pct', 'Daily Loss Limit']].map(([k, l]) => (
              <label key={k} style={{ display: 'block', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>{l}</span>
                <input type="number" step="any" value={cfg[k] ?? ''} onChange={e => setConfig(k, Number(e.target.value))}
                  style={{ display: 'block', width: '100%', padding: '6px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: 'JetBrains Mono, monospace', marginTop: 2, boxSizing: 'border-box' }} />
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input type="checkbox" checked={!!cfg.paper_mode} onChange={e => setConfig('paper_mode', e.target.checked)} />
              <span style={{ fontSize: 12, color: C.text }}>Paper Mode</span>
            </label>
          </div>
          {/* Scanner */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Scanner</div>
            {[['scanner_source', 'Source', 'select', ['polymarket', 'kalshi', 'both']], ['scan_interval_minutes', 'Interval (min)'], ['scanner_min_volume', 'Min Volume'], ['scanner_min_liquidity', 'Min Liquidity'], ['scanner_max_days', 'Max Days'], ['scanner_min_anomaly_score', 'Min Anomaly Score'], ['scanner_max_slippage_pct', 'Max Slippage']].map(([k, l, type, opts]) => (
              <label key={k} style={{ display: 'block', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>{l}</span>
                {type === 'select' ? (
                  <select value={cfg[k] || 'both'} onChange={e => setConfig(k, e.target.value)} style={{ display: 'block', width: '100%', padding: '6px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                    {opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type="number" step="any" value={cfg[k] ?? ''} onChange={e => setConfig(k, Number(e.target.value))}
                    style={{ display: 'block', width: '100%', padding: '6px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: 'JetBrains Mono, monospace', marginTop: 2, boxSizing: 'border-box' }} />
                )}
              </label>
            ))}
          </div>
          {/* LLM Providers */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>LLM Providers</div>
            {['openai', 'claude', 'gemini', 'ollama_cloud'].map(name => {
              const p = state?.providers?.[name] || {};
              return (
                <div key={name} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${C.border}22` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: p.enabled ? C.cyan : C.muted }}>{name}</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={!!p.enabled} onChange={e => setProvider(name, 'enabled', e.target.checked)} />
                      <span style={{ fontSize: 10, color: C.muted }}>aktiv</span>
                    </label>
                  </div>
                  <input placeholder="API Key" type="password" value={p.api_key || ''} onChange={e => setProvider(name, 'api_key', e.target.value)}
                    style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginBottom: 4, boxSizing: 'border-box' }} />
                  <input placeholder="Model" value={p.model || ''} onChange={e => setProvider(name, 'model', e.target.value)}
                    style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginBottom: 4, boxSizing: 'border-box' }} />
                  <input placeholder="Base URL" value={p.base_url || ''} onChange={e => setProvider(name, 'base_url', e.target.value)}
                    style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', boxSizing: 'border-box' }} />
                </div>
              );
            })}
          </div>
          {/* Market Providers */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Market APIs</div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.cyan }}>Polymarket</span>
              <input placeholder="Wallet Address" value={state?.providers?.polymarket?.wallet_address || ''} onChange={e => setProvider('polymarket', 'wallet_address', e.target.value)}
                style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginTop: 4, marginBottom: 4, boxSizing: 'border-box' }} />
              <input placeholder="EIP-712 Signature" type="password" value={state?.providers?.polymarket?.eip712_signature || ''} onChange={e => setProvider('polymarket', 'eip712_signature', e.target.value)}
                style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', boxSizing: 'border-box' }} />
            </div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.purple }}>Kalshi</span>
              <input placeholder="Key ID" value={state?.providers?.kalshi?.key_id || ''} onChange={e => setProvider('kalshi', 'key_id', e.target.value)}
                style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', marginTop: 4, marginBottom: 4, boxSizing: 'border-box' }} />
              <input placeholder="Key Secret" type="password" value={state?.providers?.kalshi?.key_secret || ''} onChange={e => setProvider('kalshi', 'key_secret', e.target.value)}
                style={{ display: 'block', width: '100%', padding: '5px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', boxSizing: 'border-box' }} />
            </div>
            <Btn onClick={() => act('connTest', async () => { const r = await apiFetch('/api/connection/test'); setConnTest(await r.json()); })} busy={busy.connTest} style={{ marginTop: 10 }}>Verbindung testen</Btn>
            {connTest && <pre style={{ fontSize: 10, color: C.muted, marginTop: 8, overflow: 'auto', maxHeight: 120 }}>{JSON.stringify(connTest, null, 2)}</pre>}
          </div>
        </div>
      </div>)}

      {/* OPS */}
      {tab === 'ops' && (<div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Metric label="Scanner Breaker" value={scanStatus?.runtime?.breaker_open ? 'OPEN' : 'CLOSED'} good={!scanStatus?.runtime?.breaker_open} />
          <Metric label="Consecutive Fails" value={scanStatus?.runtime?.consecutiveFailures || 0} good={Number(scanStatus?.runtime?.consecutiveFailures || 0) < 3} />
          <Metric label="Last Scan" value={`${fmt(scanStatus?.runtime?.lastDurationMs || 0, 0)}ms`} />
        </div>
        {/* Improvements */}
        {(improvements?.improvements || []).length > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Verbesserungspotential</div>
            {(improvements?.improvements || []).map((item, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}11` }}>
                <div style={{ fontSize: 12 }}><span style={{ color: item.severity === 'high' ? C.red : item.severity === 'medium' ? C.amber : C.muted, fontWeight: 600 }}>{item.severity}</span> &mdash; {item.area}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{item.recommendation}</div>
              </div>
            ))}
          </div>
        )}
        {/* Live Log */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Live log ({liveLog.length} events)</div>
          <div style={{ maxHeight: 300, overflow: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
            {liveLog.slice(0, 50).map((e, i) => (
              <div key={i} style={{ padding: '2px 0', color: e.event?.includes('error') ? C.red : e.event?.includes('ok') || e.event?.includes('completed') ? C.green : C.muted }}>
                <span style={{ color: C.dim }}>{(e.t || '').slice(11, 19)}</span> {e.event} {e.source ? `[${e.source}]` : ''} {e.message || e.label || ''}
              </div>
            ))}
            {!liveLog.length && <div style={{ color: C.dim }}>Noch keine Events. Starte einen Scan.</div>}
          </div>
        </div>
      </div>)}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}*{box-sizing:border-box}::-webkit-scrollbar{height:4px;width:4px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.dim};border-radius:2px}`}</style>
    </div>
  );
}
