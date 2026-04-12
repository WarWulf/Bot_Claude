import { useEffect, useMemo, useState } from 'react';

function fmtNum(value, digits = 2) {
  const n = Number(value);
  if (Number.isNaN(n)) return '-';
  return n.toFixed(digits);
}

function StatusPill({ ok, label }) {
  return <span className={`pill ${ok ? 'ok' : 'bad'}`}>{label}</span>;
}

function explainStep1Selection(market, cfg = {}) {
  const minVolume = Number(cfg.scanner_min_volume || 200);
  const minLiquidity = Number(cfg.scanner_min_liquidity || 200);
  const maxDays = Number(cfg.scanner_max_days || 30);
  const maxSlippage = Number(cfg.scanner_max_slippage_pct || 0.02);
  const minScore = Number(cfg.scanner_min_anomaly_score || 1);
  const reasons = [];

  if (Number(market.volume || 0) >= minVolume) reasons.push(`Volumen passt: ${fmtNum(market.volume, 0)} ≥ ${fmtNum(minVolume, 0)}`);
  if (Number(market.liquidity || 0) >= minLiquidity) reasons.push(`Liquidität passt: ${fmtNum(market.liquidity, 0)} ≥ ${fmtNum(minLiquidity, 0)}`);
  if (Number(market.days_to_expiry || 999) <= maxDays) reasons.push(`Laufzeit passt: ${fmtNum(market.days_to_expiry, 0)} Tage ≤ ${fmtNum(maxDays, 0)}`);
  if (Number(market.estimated_slippage || 0) <= maxSlippage) reasons.push(`Slippage passt: ${fmtNum(market.estimated_slippage || 0, 3)} ≤ ${fmtNum(maxSlippage, 3)}`);
  if (Number(market.opportunity_score || 0) >= minScore) reasons.push(`Opportunity Score passt: ${fmtNum(market.opportunity_score || 0, 2)} ≥ ${fmtNum(minScore, 2)}`);

  const flags = Array.isArray(market.anomaly_flags) ? market.anomaly_flags : [];
  if (flags.includes('sudden_price_move')) reasons.push('Anomalie: plötzliche Preisbewegung');
  if (flags.includes('wide_spread')) reasons.push('Anomalie: breiter Spread');
  if (flags.includes('volume_spike')) reasons.push('Anomalie: Volumen-Spike vs. 7-Tage-Schnitt');

  return reasons;
}

const STEP1_CONFIG_GUIDE = [
  {
    key: 'scanner_source',
    label: 'scanner_source',
    type: 'select',
    options: ['polymarket', 'kalshi', 'both'],
    recommended: 'both',
    impact: 'Welche Börsen gescannt werden.',
    why: 'Mehr Datenquellen erhöhen die Chance auf gute Setups, brauchen aber mehr API-Calls.'
  },
  {
    key: 'scan_interval_minutes',
    label: 'scan_interval_minutes',
    type: 'number',
    recommended: 15,
    impact: 'Wie oft automatisch gescannt wird.',
    why: '15 Minuten ist ein guter Kompromiss aus Aktualität und Stabilität.'
  },
  {
    key: 'top_n',
    label: 'top_n',
    type: 'number',
    recommended: 10,
    impact: 'Wie viele Tradeable Märkte in die nächste Stufe (Research/Predict) übernommen werden.',
    why: '10 ist ein guter Startwert: genug Diversität, aber noch gut manuell prüfbar.'
  },
  {
    key: 'scanner_min_volume',
    label: 'scanner_min_volume',
    type: 'number',
    recommended: 50000,
    impact: 'Filtert Märkte mit zu wenig Handelsaktivität.',
    why: 'Höher = weniger, aber meist robustere Märkte. Niedriger = mehr Kandidaten, oft mehr Rauschen.'
  },
  {
    key: 'scanner_min_liquidity',
    label: 'scanner_min_liquidity',
    type: 'number',
    recommended: 10000,
    impact: 'Mindestliquidität für handelbare Märkte.',
    why: 'Zu niedrig erhöht Slippage-Risiko. Zu hoch kann zu wenig Märkte übrig lassen.'
  },
  {
    key: 'scanner_max_days',
    label: 'scanner_max_days',
    type: 'number',
    recommended: 30,
    impact: 'Maximal erlaubte Restlaufzeit bis Marktende.',
    why: 'Kürzere Laufzeit fokussiert auf Events mit klarerem Zeithorizont.'
  },
  {
    key: 'scanner_min_anomaly_score',
    label: 'scanner_min_anomaly_score',
    type: 'number',
    step: 0.1,
    recommended: 1.2,
    impact: 'Mindestwert für auffällige Preis-/Volumenmuster.',
    why: 'Höher = nur starke Signale. Niedriger = mehr Signale, aber häufiger Fehlalarme.'
  },
  {
    key: 'scanner_max_slippage_pct',
    label: 'scanner_max_slippage_pct',
    type: 'number',
    step: 0.001,
    recommended: 0.02,
    impact: 'Maximal tolerierte geschätzte Slippage beim Einstieg.',
    why: '2% schützt vor zu teuren Ausführungen in dünnen Märkten.'
  },
  {
    key: 'scanner_http_retries',
    label: 'scanner_http_retries',
    type: 'number',
    recommended: 2,
    impact: 'Wie oft fehlgeschlagene API-Calls wiederholt werden.',
    why: '2 Retries fangen kurze Netzwerkprobleme ab, ohne Scanner stark zu verlangsamen.'
  },
  {
    key: 'scanner_http_timeout_ms',
    label: 'scanner_http_timeout_ms',
    type: 'number',
    recommended: 8000,
    impact: 'Maximale Wartezeit pro API-Request.',
    why: '8 Sekunden verhindert Hänger bei langsamen Endpunkten.'
  },
  {
    key: 'scanner_breaker_threshold',
    label: 'scanner_breaker_threshold',
    type: 'number',
    recommended: 3,
    impact: 'Fehleranzahl bis Circuit-Breaker den Scanner pausiert.',
    why: 'Schützt gegen Endlosschleifen bei Provider-Problemen.'
  },
  {
    key: 'scanner_breaker_cooldown_sec',
    label: 'scanner_breaker_cooldown_sec',
    type: 'number',
    recommended: 300,
    impact: 'Wartezeit nach Breaker-Auslösung.',
    why: '5 Minuten geben APIs Zeit zur Erholung.'
  },
  {
    key: 'scanner_active_from_utc',
    label: 'scanner_active_from_utc',
    type: 'number',
    recommended: 0,
    impact: 'Startstunde des aktiven Scan-Zeitfensters (UTC).',
    why: '0–24 deckt den ganzen Tag ab; engeres Fenster spart Ressourcen.'
  },
  {
    key: 'scanner_active_to_utc',
    label: 'scanner_active_to_utc',
    type: 'number',
    recommended: 24,
    impact: 'Endstunde des aktiven Scan-Zeitfensters (UTC).',
    why: 'Zusammen mit active_from steuerst du, wann der Scheduler laufen darf.'
  }
];

const STEP1_PRESETS = {
  konservativ: {
    scanner_source: 'both',
    scan_interval_minutes: 20,
    scanner_min_volume: 100000,
    scanner_min_liquidity: 20000,
    scanner_max_days: 21,
    scanner_min_anomaly_score: 1.6,
    scanner_max_slippage_pct: 0.015,
    scanner_http_retries: 2,
    scanner_http_timeout_ms: 8000,
    scanner_breaker_threshold: 3,
    scanner_breaker_cooldown_sec: 300,
    scanner_active_from_utc: 0,
    scanner_active_to_utc: 24
  },
  aggressiv: {
    scanner_source: 'both',
    scan_interval_minutes: 15,
    scanner_min_volume: 10000,
    scanner_min_liquidity: 2000,
    scanner_max_days: 45,
    scanner_min_anomaly_score: 0.8,
    scanner_max_slippage_pct: 0.04,
    scanner_http_retries: 2,
    scanner_http_timeout_ms: 8000,
    scanner_breaker_threshold: 3,
    scanner_breaker_cooldown_sec: 300,
    scanner_active_from_utc: 0,
    scanner_active_to_utc: 24
  }
};

export default function App() {
  const [state, setState] = useState(null);
  const [scanPreview, setScanPreview] = useState([]);
  const [scanRuns, setScanRuns] = useState([]);
  const [authStatus, setAuthStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [scanStatus, setScanStatus] = useState(null);
  const [scanSelfTest, setScanSelfTest] = useState(null);
  const [connectionTest, setConnectionTest] = useState(null);
  const [liveLog, setLiveLog] = useState([]);
  const [llmLiveLog, setLlmLiveLog] = useState([]);
  const [loggingStatus, setLoggingStatus] = useState(null);
  const [stepStatus, setStepStatus] = useState(null);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [scanRecommendationLog, setScanRecommendationLog] = useState(null);
  const [improvementReport, setImprovementReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState({
    scan: false,
    research: false,
    predict: false,
    execute: false,
    risk: false,
    pipeline: false,
    connectionTest: false,
    testPolymarket: false,
    testKalshi: false,
    tokenSave: false,
    resetMarkets: false,
    llmRecommendation: false,
    finalizeStep1: false
  });
  const [message, setMessage] = useState('');
  const [uiAuthEnabled, setUiAuthEnabled] = useState(false);
  const [uiAuthed, setUiAuthed] = useState(false);
  const [uiPassword, setUiPassword] = useState('');
  const [uiPasswordInput, setUiPasswordInput] = useState('');
  const [uiCurrentPasswordInput, setUiCurrentPasswordInput] = useState('');
  const [uiNewPasswordInput, setUiNewPasswordInput] = useState('');
  const [tab, setTab] = useState('scanMarkets');
  const [marketFilter, setMarketFilter] = useState('');
  const [briefFilter, setBriefFilter] = useState('');

  async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (uiPassword) headers['x-ui-password'] = uiPassword;
    return fetch(path, { ...options, headers });
  }

  async function apiFetchJson(path, fallback, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await apiFetch(path, { signal: controller.signal });
      if (!res.ok) throw new Error(`${path} -> http ${res.status}`);
      return await res.json();
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }

  async function reloadState() {
    const [
      statePayload,
      scanPayload,
      authPayload,
      healthPayload,
      scanStatusPayload,
      scanSelfTestPayload,
      connectionTestPayload,
      liveLogPayload,
      loggingStatusPayload,
      stepStatusPayload,
      pipelineStatusPayload,
      scanRecommendationLogPayload,
      improvementReportPayload
    ] = await Promise.all([
      apiFetchJson('/api/state', null),
      apiFetchJson('/api/scan', { markets: [], runs: [] }),
      apiFetchJson('/api/auth/status', { polymarket: { configured: false }, kalshi: { configured: false } }),
      apiFetchJson('/api/health', { status: 'degraded' }),
      apiFetchJson('/api/scan/status', { runtime: {}, metrics: {} }),
      apiFetchJson('/api/scan/self-test', { ok: false, checks: [] }),
      apiFetchJson('/api/connection/test', null),
      apiFetchJson('/api/scan/live-log', { items: [] }),
      apiFetchJson('/api/logging/connection-status', { backend_online: false, comm_connected: false }),
      apiFetchJson('/api/status/steps', { step1: { progress_pct: 0 }, step2: { progress_pct: 0 }, step3: { progress_pct: 0 }, step4: { progress_pct: 0 }, step5: { progress_pct: 0 } }),
      apiFetchJson('/api/pipeline/status', { runs: [], skills: [] }),
      apiFetchJson('/api/research/scan-recommendations/log', { items: [] }),
      apiFetchJson('/api/improvements', { items: [], summary: { high: 0, medium: 0, low: 0 } })
    ]);
    if (!statePayload) {
      throw new Error('state endpoint unreachable');
    }
    setState(statePayload);
    setScanPreview(scanPayload.markets || []);
    setScanRuns(scanPayload.runs || []);
    setAuthStatus(authPayload);
    setHealth(healthPayload);
    setScanStatus(scanStatusPayload);
    setScanSelfTest(scanSelfTestPayload);
    setConnectionTest(connectionTestPayload);
    setLiveLog(liveLogPayload?.items || []);
    setLoggingStatus(loggingStatusPayload);
    setStepStatus(stepStatusPayload);
    setPipelineStatus(pipelineStatusPayload);
    setScanRecommendationLog(scanRecommendationLogPayload);
    setImprovementReport(improvementReportPayload);
  }

  async function initUiAuth() {
    const statusRes = await fetch('/api/ui-auth/status');
    const statusPayload = await statusRes.json();
    setUiAuthEnabled(Boolean(statusPayload.enabled));
    if (!statusPayload.enabled) {
      setUiAuthed(true);
      await reloadState();
      return;
    }

    const saved = localStorage.getItem('ui_password') || '';
    if (!saved) {
      setUiAuthed(false);
      return;
    }

    const loginRes = await fetch('/api/ui-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: saved })
    });
    if (!loginRes.ok) {
      localStorage.removeItem('ui_password');
      setUiAuthed(false);
      return;
    }
    setUiPassword(saved);
    setUiAuthed(true);
    await reloadState();
  }

  async function submitUiLogin() {
    try {
      const r = await fetch('/api/ui-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: uiPasswordInput })
      });
      const p = await r.json();
      if (!r.ok || !p.ok) throw new Error(p.message || 'Login fehlgeschlagen');
      localStorage.setItem('ui_password', uiPasswordInput);
      setUiPassword(uiPasswordInput);
      setUiPasswordInput('');
      setUiAuthed(true);
      setMessage('UI Login erfolgreich');
      await reloadState();
    } catch (e) {
      setMessage(`Login Fehler: ${e.message}`);
      setUiAuthed(false);
    }
  }

  async function updateUiPassword() {
    try {
      const r = await fetch('/api/ui-auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: uiCurrentPasswordInput, new_password: uiNewPasswordInput })
      });
      const p = await r.json();
      if (!r.ok || !p.ok) throw new Error(p.message || 'Passwort-Update fehlgeschlagen');
      localStorage.setItem('ui_password', uiNewPasswordInput);
      setUiPassword(uiNewPasswordInput);
      setUiCurrentPasswordInput('');
      setUiNewPasswordInput('');
      setMessage('UI Passwort gespeichert und für Neustarts persistent hinterlegt.');
    } catch (e) {
      setMessage(`UI Passwort Fehler: ${e.message}`);
    }
  }

  useEffect(() => { initUiAuth().catch((e) => setMessage(`Ladefehler: ${e.message}`)); }, []);

  function updateConfig(key, value) {
    setState((prev) => ({ ...prev, config: { ...prev.config, [key]: value } }));
  }

  function updateProvider(name, key, value) {
    setState((prev) => ({
      ...prev,
      providers: {
        ...(prev.providers || {}),
        [name]: {
          ...((prev.providers || {})[name] || {}),
          [key]: value
        }
      }
    }));
  }

  function applyStep1Recommended() {
    setState((prev) => {
      const nextConfig = { ...(prev.config || {}) };
      STEP1_CONFIG_GUIDE.forEach((entry) => {
        nextConfig[entry.key] = entry.recommended;
      });
      return { ...prev, config: nextConfig };
    });
    setMessage('Empfohlene Step-1 Werte gesetzt. Bitte anschließend "Settings speichern".');
  }

  function applyStep1Preset(name) {
    const preset = STEP1_PRESETS[name];
    if (!preset) return;
    setState((prev) => ({ ...prev, config: { ...(prev.config || {}), ...preset } }));
    setMessage(`Preset "${name}" geladen. Bitte anschließend Settings speichern.`);
  }

  async function withBusy(key, action, successMsg) {
    setBusy((prev) => ({ ...prev, [key]: true }));
    try {
      await action();
      if (successMsg) setMessage(successMsg);
      await reloadState();
    } catch (e) {
      setMessage(`Fehler: ${e.message}`);
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      await apiFetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: state.config, providers: state.providers })
      });
      setMessage('Settings gespeichert');
      await reloadState();
    } catch (e) {
      setMessage(`Save Fehler: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function runScan() {
    await withBusy('scan', async () => {
      const r = await apiFetch('/api/scan/run', { method: 'POST' });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'scan failed');
      setMessage(`Scan fertig (${p.tradeable_count})`);
    });
  }

  async function runResearch() {
    await withBusy('research', async () => {
      const r = await apiFetch('/api/research/run', { method: 'POST' });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'research failed');
      setMessage(`Research fertig (${(p.briefs || []).length})`);
    });
  }

  async function runPredict() {
    await withBusy('predict', async () => {
      const r = await apiFetch('/api/predict/run', { method: 'POST' });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'predict failed');
      setMessage(`Step 3 fertig (${(p.predictions || []).length} Predictions)`);
    });
  }

  async function runExecute() {
    await withBusy('execute', async () => {
      const r = await apiFetch('/api/execute/run', { method: 'POST' });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'execute failed');
      setMessage(`Step 4 fertig (${p.summary?.executed_orders || 0} Orders).`);
    });
  }

  async function runRiskStepNow() {
    await withBusy('risk', async () => {
      const r = await apiFetch('/api/risk/run', { method: 'POST' });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'risk step failed');
      setMessage(`Step 5 fertig (Violations: ${p.summary?.violations || 0}).`);
    });
  }

  async function runFullPipeline() {
    await withBusy('pipeline', async () => {
      const r = await apiFetch('/api/pipeline/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'pipeline failed');
      setMessage('5-Step Pipeline erfolgreich ausgeführt.');
    });
  }

  async function resetMarkets() {
    await withBusy('resetMarkets', async () => {
      const r = await apiFetch('/api/markets/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'ui reset' })
      });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'reset failed');
      setMessage(`Märkte zurückgesetzt (vorher ${p.previous_markets} Märkte, ${p.previous_tradeable} tradeable).`);
    });
  }

  async function finalizeStep1() {
    await withBusy('finalizeStep1', async () => {
      const r = await apiFetch('/api/step1/finalize', { method: 'POST' });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'step1 finalize failed');
      setMessage(`Step 1 finalisiert: ${p.step1_progress_pct || 0}% (tradeable: ${p.tradeable_count || 0}).`);
    });
  }

  async function applyLlmScanRecommendation() {
    await withBusy('llmRecommendation', async () => {
      const r = await apiFetch('/api/research/scan-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_research: true })
      });
      const p = await r.json();
      if (!p.ok) throw new Error(p.message || 'llm recommendation failed');
      const selected = p.llm || p.heuristic || {};
      const merged = { ...(state.config || {}) };
      ['scanner_min_volume', 'scanner_min_liquidity', 'scanner_max_slippage_pct', 'scanner_min_anomaly_score', 'scan_interval_minutes', 'top_n']
        .forEach((k) => {
          if (Number.isFinite(Number(selected[k]))) merged[k] = Number(selected[k]);
        });
      setState((prev) => ({ ...prev, config: merged }));
      const shortWhy = p.human_explanation?.bullets?.[3] || p.human_explanation?.text || '';
      setMessage(`LLM Empfehlung geladen (${p.llm_provider || 'heuristic fallback'}). ${shortWhy} Bitte Settings speichern.`);
    });
  }

  async function runConnectionTest() {
    await withBusy('connectionTest', async () => {
      const r = await apiFetch('/api/connection/test');
      const p = await r.json();
      setConnectionTest(p);
      if (!p.ok) throw new Error('Kein Anbieter erreichbar. Prüfe Keys, URLs und Timeout.');
      setMessage('Verbindungstest erfolgreich. Mindestens ein Anbieter erreichbar.');
    });
  }

  async function runProviderConnectionTest(provider) {
    const key = provider === 'polymarket' ? 'testPolymarket' : 'testKalshi';
    await withBusy(key, async () => {
      const r = await apiFetch(`/api/connection/test/${provider}`);
      const p = await r.json();
      setConnectionTest((prev) => ({ ...(prev || {}), [provider]: p, provider_last_test: p }));
      if (!p.ok) throw new Error(`${provider} nicht erreichbar. Details im JSON unten.`);
      setMessage(`${provider} Verbindungstest erfolgreich.`);
    });
  }

  async function saveTokensOnly() {
    setBusy((prev) => ({ ...prev, tokenSave: true }));
    try {
      await apiFetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: state.providers, config: {} })
      });
      setMessage('API Tokens/Keys gespeichert.');
      await reloadState();
    } catch (e) {
      setMessage(`Token-Save Fehler: ${e.message}`);
    } finally {
      setBusy((prev) => ({ ...prev, tokenSave: false }));
    }
  }

  const summary = useMemo(() => {
    if (!state) return null;
    const health = state.scanner_health || {};
    return {
      markets: Number(health.total || 0),
      open: Number(health.open || 0),
      tradeable: Number(scanPreview.length || 0),
      scanRuns: Number(scanRuns.length || 0),
      briefs: Number((state.research_briefs || []).length)
    };
  }, [state, scanPreview, scanRuns]);

  const visibleMarkets = useMemo(() => {
    const q = marketFilter.trim().toLowerCase();
    if (!q) return scanPreview;
    return scanPreview.filter((m) => String(m.question || '').toLowerCase().includes(q) || String(m.market || '').toLowerCase().includes(q));
  }, [scanPreview, marketFilter]);

  const visibleBriefs = useMemo(() => {
    const q = briefFilter.trim().toLowerCase();
    const briefs = state?.research_briefs || [];
    if (!q) return briefs;
    return briefs.filter((b) => String(b.question || '').toLowerCase().includes(q) || String(b.stance || '').toLowerCase().includes(q));
  }, [state, briefFilter]);
  const topN = Math.max(1, Number(state?.config?.top_n || 10));
  const topTradeableMarkets = useMemo(() => visibleMarkets.slice(0, topN), [visibleMarkets, topN]);

  const step1RecommendationStats = useMemo(() => {
    if (!state?.config) return { matches: 0, total: STEP1_CONFIG_GUIDE.length };
    const matches = STEP1_CONFIG_GUIDE.filter((entry) => {
      const current = state.config[entry.key];
      return String(current) === String(entry.recommended);
    }).length;
    return { matches, total: STEP1_CONFIG_GUIDE.length };
  }, [state]);

  const step1FailedChecks = (stepStatus?.step1?.checks || []).filter((c) => !c.ok).map((c) => c.key);
  const step2FailedChecks = (stepStatus?.step2?.checks || []).filter((c) => !c.ok).map((c) => c.key);

  useEffect(() => {
    if (tab !== 'ops' || !uiAuthed) return;
    const timer = setInterval(async () => {
      const payload = await apiFetchJson('/api/scan/live-log', { items: [] }, 6000);
      setLiveLog(payload?.items || []);
      const loggingPayload = await apiFetchJson('/api/logging/connection-status', { backend_online: false, comm_connected: false }, 6000);
      setLoggingStatus(loggingPayload);
    }, 4000);
    return () => clearInterval(timer);
  }, [tab, uiAuthed]);

  if (uiAuthEnabled && !uiAuthed) {
    return (
      <main className="page">
        <section className="card">
          <h2>UI Passwortschutz</h2>
          <p className="sectionHelp">Dieses Dashboard ist passwortgeschützt. Bitte Passwort eingeben.</p>
          <label>UI Password
            <input type="password" value={uiPasswordInput} onChange={(e) => setUiPasswordInput(e.target.value)} />
          </label>
          <div className="row">
            <button onClick={submitUiLogin}>Login</button>
          </div>
          <p className="hint">{message}</p>
        </section>
      </main>
    );
  }

  if (!state) return <main className="page"><p>Lade ...</p></main>;

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1>Prediction Market Bot</h1>
          <p className="sub">Step 1 Scanner + Step 2 Research Dashboard</p>
        </div>
        <div className="headerActions">
          <button onClick={() => reloadState().catch((e) => setMessage(`Reload Fehler: ${e.message}`))}>Refresh</button>
          <button onClick={saveSettings} disabled={saving}>{saving ? 'Speichert…' : 'Settings speichern'}</button>
        </div>
      </header>

      <p className="hint">{message}</p>

      <section className="card introCard">
        <h2>So nutzt du das Dashboard</h2>
        <ol>
          <li><strong>Step 1:</strong> Scan-Config setzen und <em>Scan starten</em>.</li>
          <li><strong>Step 2:</strong> Bei vorhandenen Märkten <em>Research starten</em>, dann Briefs prüfen.</li>
          <li><strong>Ops:</strong> Auth, WebSocket und Logs beobachten, dann Settings final speichern.</li>
        </ol>
        <div className="rowGap">
          <StatusPill ok={health?.status === 'ok'} label={`Backend: ${health?.status || 'unbekannt'}`} />
          <StatusPill ok={!!authStatus?.polymarket?.configured} label={`Polymarket Key: ${authStatus?.polymarket?.configured ? 'gesetzt' : 'fehlt'}`} />
          <StatusPill ok={!!authStatus?.kalshi?.configured} label={`Kalshi Key: ${authStatus?.kalshi?.configured ? 'gesetzt' : 'fehlt'}`} />
          <StatusPill ok={Number(stepStatus?.step1?.progress_pct || 0) >= 100} label={`Step 1: ${stepStatus?.step1?.progress_pct || 0}%`} />
          <StatusPill ok={Number(stepStatus?.step2?.progress_pct || 0) >= 100} label={`Step 2: ${stepStatus?.step2?.progress_pct || 0}%`} />
        </div>
      </section>

      <section className="card">
        <h2>Action Center (mit Erklärung)</h2>
        <div className="row">
          <button onClick={runScan} disabled={busy.scan}>{busy.scan ? 'Scan läuft…' : 'Scan starten'}</button>
          <button onClick={finalizeStep1} disabled={busy.finalizeStep1}>{busy.finalizeStep1 ? 'Finalisiere Step 1…' : 'Step 1 finalisieren (Auto-Preset + Scan)'}</button>
          <button onClick={runResearch} disabled={busy.research || !scanPreview.length}>{busy.research ? 'Research läuft…' : 'Research starten'}</button>
          <button onClick={runPredict} disabled={busy.predict || !(state?.research_briefs || []).length}>{busy.predict ? 'Predict läuft…' : 'Step 3 Predict starten'}</button>
          <button onClick={runFullPipeline} disabled={busy.pipeline}>{busy.pipeline ? 'Pipeline läuft…' : '5-Step Pipeline starten'}</button>
        </div>
        <ul>
          <li><strong>Scan starten:</strong> lädt Märkte von Polymarket/Kalshi, filtert und ranked nach Scan-Config.</li>
          <li><strong>Research starten:</strong> erzeugt Briefs für Top-N Märkte aus den aktivierten Quellen.</li>
          <li><strong>Step 3 Predict starten:</strong> berechnet Modell-Wahrscheinlichkeiten (inkl. LLM-Ensemble falls aktiviert).</li>
          <li><strong>5-Step Pipeline starten:</strong> führt Scan → Research → Predict → Execute → Risk am Stück aus.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Step Progress</h2>
        <p className="sectionHelp">Prozent = erfüllte Checks / Gesamt-Checks je Step. 83,3% bedeutet typischerweise 5 von 6 Checks erfüllt.</p>
        <div className="progressWrap">
          <label>Step 1</label>
          <progress max="100" value={Number(stepStatus?.step1?.progress_pct || 0)} />
          <span>{stepStatus?.step1?.progress_pct || 0}%</span>
        </div>
        {!!step1FailedChecks.length && (
          <p className="meta">Step 1 fehlt noch: {step1FailedChecks.join(', ')}</p>
        )}
        <div className="progressWrap">
          <label>Step 2</label>
          <progress max="100" value={Number(stepStatus?.step2?.progress_pct || 0)} />
          <span>{stepStatus?.step2?.progress_pct || 0}%</span>
        </div>
        {!!step2FailedChecks.length && (
          <p className="meta">Step 2 fehlt noch: {step2FailedChecks.join(', ')}</p>
        )}
        <div className="progressWrap">
          <label>Step 3</label>
          <progress max="100" value={Number(stepStatus?.step3?.progress_pct || 0)} />
          <span>{stepStatus?.step3?.progress_pct || 0}%</span>
        </div>
        <div className="progressWrap">
          <label>Step 4</label>
          <progress max="100" value={Number(stepStatus?.step4?.progress_pct || 0)} />
          <span>{stepStatus?.step4?.progress_pct || 0}%</span>
        </div>
        <div className="progressWrap">
          <label>Step 5</label>
          <progress max="100" value={Number(stepStatus?.step5?.progress_pct || 0)} />
          <span>{stepStatus?.step5?.progress_pct || 0}%</span>
        </div>
      </section>

      <section className="card">
        <h2>Was fehlt noch? (Verbesserungspotential)</h2>
        <p className="sectionHelp">Automatische Analyse der aktuellen Lücken, Interaktionsprobleme und Umsetzungs-Risiken.</p>
        <p className="sectionHelp">High: {improvementReport?.summary?.high || 0} · Medium: {improvementReport?.summary?.medium || 0} · Low: {improvementReport?.summary?.low || 0}</p>
        <div className="list">
          {(improvementReport?.items || []).map((item, idx) => (
            <article className="marketItem" key={`imp-${idx}`}>
              <div>
                <strong>{item.area} ({item.severity})</strong>
                <div className="meta">{item.missing}</div>
              </div>
              <p className="meta">{item.recommendation}</p>
            </article>
          ))}
          {!(improvementReport?.items || []).length && <p>Aktuell keine offenen Verbesserungs-Punkte erkannt.</p>}
        </div>
      </section>

      <section className="statsGrid">
        <article className="statCard"><span>Markets</span><strong>{summary.markets}</strong></article>
        <article className="statCard"><span>Open</span><strong>{summary.open}</strong></article>
        <article className="statCard"><span>Tradeable</span><strong>{summary.tradeable}</strong></article>
        <article className="statCard"><span>Research Briefs</span><strong>{summary.briefs}</strong></article>
        <article className="statCard"><span>Scan Runs</span><strong>{summary.scanRuns}</strong></article>
      </section>

      <section className="tabRow">
        <button className={tab === 'scanMarkets' ? 'tab active' : 'tab'} onClick={() => setTab('scanMarkets')}>Scan & Märkte</button>
        <button className={tab === 'research' ? 'tab active' : 'tab'} onClick={() => setTab('research')}>Research</button>
        <button className={tab === 'predict' ? 'tab active' : 'tab'} onClick={() => setTab('predict')}>Predict</button>
        <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>Einstellungen</button>
        <button className={tab === 'ops' ? 'tab active' : 'tab'} onClick={() => setTab('ops')}>Ops / Status</button>
      </section>

      {tab === 'scanMarkets' && (
        <>
          <section className="statsGrid">
            <article className="statCard"><span>Last Scan Duration</span><strong>{fmtNum(scanStatus?.metrics?.last_duration_ms || 0, 0)} ms</strong></article>
            <article className="statCard"><span>Avg Scan Duration</span><strong>{fmtNum(scanStatus?.metrics?.avg_duration_ms || 0, 0)} ms</strong></article>
            <article className="statCard"><span>Coverage PM</span><strong>{scanStatus?.metrics?.last_coverage?.polymarket || 0}</strong></article>
            <article className="statCard"><span>Coverage Kalshi</span><strong>{scanStatus?.metrics?.last_coverage?.kalshi || 0}</strong></article>
          </section>

          <section className="card">
            <h2>Scan Config</h2>
            <p className="sectionHelp">Definiert, welche Märkte in Step 1 als tradeable und auffällig gerankt werden.</p>
            <p className="sectionHelp">
              Empfehlungstreffer: <strong>{step1RecommendationStats.matches}/{step1RecommendationStats.total}</strong> auf empfohlenen Werten.
            </p>
            <div className="row">
              <button onClick={applyStep1Recommended}>Empfehlung Standard</button>
              <button onClick={applyLlmScanRecommendation} disabled={busy.llmRecommendation}>{busy.llmRecommendation ? 'LLM analysiert…' : 'Empfehlung LLM (macht Research)'}</button>
              <button onClick={() => applyStep1Preset('konservativ')}>Preset: Konservativ</button>
              <button onClick={() => applyStep1Preset('aggressiv')}>Preset: Aggressiv</button>
              <button onClick={resetMarkets} disabled={busy.resetMarkets}>{busy.resetMarkets ? 'Reset läuft…' : 'Reset Märkte (passwortgeschützt)'}</button>
            </div>
            <p className="sectionHelp">Konservativ = weniger, stabilere Märkte. Aggressiv = mehr Treffer, aber mehr Rauschen/Slippage-Risiko.</p>
            <div className="grid">
              {STEP1_CONFIG_GUIDE.map((entry) => {
                const currentValue = state.config[entry.key];
                const isRecommended = String(currentValue) === String(entry.recommended);
                const tooltip = `${entry.impact} Empfohlen: ${entry.recommended}. ${entry.why}`;
                return (
                  <label key={entry.key} className="configLabel">
                    <div className="configLabelTop">
                      <span>{entry.label}</span>
                      <span className={isRecommended ? 'recBadge match' : 'recBadge'}>Empfohlen: {String(entry.recommended)}</span>
                      <span className="tooltipIcon" title={tooltip} aria-label={tooltip}>ⓘ</span>
                    </div>
                    {entry.type === 'select' ? (
                      <select value={currentValue} onChange={(e) => updateConfig(entry.key, e.target.value)}>
                        {entry.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type="number"
                        step={entry.step}
                        value={currentValue}
                        onChange={(e) => updateConfig(entry.key, Number(e.target.value))}
                      />
                    )}
                    <small className="configHelp">{entry.impact}</small>
                    <small className="configWhy">{entry.why}</small>
                  </label>
                );
              })}
            </div>
            <details>
              <summary>Wie teste ich Step 1 korrekt?</summary>
              <ol>
                <li>Empfohlene Werte laden und speichern, dann <strong>Scan starten</strong>.</li>
                <li>Prüfen, ob in <strong>Top Tradeable Markets</strong> Ergebnisse erscheinen (mindestens 1–5 Märkte).</li>
                <li>Im Tab <strong>Ops / Status</strong> prüfen: <code>Step 1 Self-Test</code> sollte <code>ok: true</code> melden.</li>
                <li><code>/api/scan/status</code> prüfen: Dauer, Coverage und Breaker sollten plausibel sein (Breaker idealerweise CLOSED).</li>
                <li>Grenzwert-Test: <code>scanner_min_volume</code> stark erhöhen (z. B. 500000), Scan erneut starten – erwartbar weniger Treffer.</li>
                <li>Gegenprobe: <code>scanner_min_volume</code> auf 10000 senken – erwartbar mehr Treffer, aber oft geringere Qualität.</li>
              </ol>
            </details>
            <details open>
              <summary>Warum diese Scan-Empfehlungen? (menschliche Erklärung + Log)</summary>
              <p className="sectionHelp">Hier siehst du erst eine verständliche Erklärung und darunter die Rohdaten.</p>
              {!!scanRecommendationLog?.latest?.human_explanation && (
                <div className="callout">
                  <strong>Verständliche Begründung ({scanRecommendationLog.latest.human_explanation.mode})</strong>
                  <p>{scanRecommendationLog.latest.human_explanation.text}</p>
                  <ul>
                    {(scanRecommendationLog.latest.human_explanation.bullets || []).map((b, idx) => <li key={idx}>{b}</li>)}
                  </ul>
                </div>
              )}
              <pre>{JSON.stringify(scanRecommendationLog?.latest || {}, null, 2)}</pre>
            </details>
          </section>

          <section className="card">
            <h2>Top Tradeable Markets</h2>
            <p className="sectionHelp">Top-Ergebnisse aus dem letzten Scan. Diese Märkte gehen als Input in Step 2 Research.</p>
            <p className="sectionHelp">Top-N aktuell: <strong>{topTradeableMarkets.length}/{topN}</strong></p>
            <p className="sectionHelp">Warum oft 10? Weil <code>top_n</code> standardmäßig 10 ist. Genau diese Top-N werden in Step 2 als Research Briefs verarbeitet.</p>
            <div className="callout">
              <strong>Wie lese ich die Kennzahlen?</strong>
              <ul>
                <li><strong>P</strong> = aktueller Marktpreis (implied probability).</li>
                <li><strong>V</strong> = Volume (Handelsaktivität).</li>
                <li><strong>L</strong> = Liquidity/Open Interest (Handelbarkeit).</li>
                <li><strong>S</strong> = Spread (enge Spreads sind besser).</li>
                <li><strong>Score</strong> = Opportunity Score aus Anomalien + Marktqualität.</li>
              </ul>
            </div>
            <input type="text" placeholder="Markets filtern (Frage/Market-ID)" value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)} />
            <details open>
              <summary>Top-{topN} Märkte anzeigen / ausblenden</summary>
              <div className="list scrollList">
                {topTradeableMarkets.map((m) => (
                  <article className="marketItem" key={`${m.platform}-${m.market}`}>
                    <div>
                      <strong>{m.question}</strong>
                      <div className="meta">{m.platform} · {m.market}</div>
                    </div>
                    <div className="metrics">
                      <span>P {fmtNum(m.market_price, 3)}</span>
                      <span>V {fmtNum(m.volume, 0)}</span>
                      <span>L {fmtNum(m.liquidity, 0)}</span>
                      <span>S {fmtNum(m.spread, 3)}</span>
                      <span>Score {fmtNum(m.opportunity_score, 1)}</span>
                    </div>
                    <p className="meta"><strong>Warum ausgewählt?</strong></p>
                    <ul className="reasonList">
                      {explainStep1Selection(m, state.config).map((r, idx) => <li key={idx}>{r}</li>)}
                    </ul>
                  </article>
                ))}
                {!topTradeableMarkets.length && <p>Keine passenden Markets. Starte zuerst einen Scan oder passe den Filter an.</p>}
              </div>
            </details>
          </section>

          <section className="card">
            <h2>Alle gescannten Märkte</h2>
            <p className="sectionHelp">Vollständige Marktliste (nicht nur Top-10). Hilft beim Debugging und bei der Quellenauswahl für Step 2.</p>
            <p className="sectionHelp">Gesamt: <strong>{(state.markets || []).length}</strong></p>
            <details>
              <summary>Alle Märkte anzeigen / ausblenden</summary>
              <div className="list scrollList">
                {(state.markets || [])
                  .filter((m) => {
                    if (!marketFilter.trim()) return true;
                    const q = marketFilter.toLowerCase();
                    return String(m.question || '').toLowerCase().includes(q) || String(m.market || '').toLowerCase().includes(q);
                  })
                  .slice(0, 400)
                  .map((m) => (
                    <article className="marketItem" key={`all-${m.platform}-${m.market}`}>
                      <div>
                        <strong>{m.question}</strong>
                        <div className="meta">{m.platform} · {m.market}</div>
                      </div>
                      <div className="metrics">
                        <span>P {fmtNum(m.market_price, 3)}</span>
                        <span>V {fmtNum(m.volume, 0)}</span>
                        <span>L {fmtNum(m.liquidity, 0)}</span>
                        <span>S {fmtNum(m.spread, 3)}</span>
                        <span>Score {fmtNum(m.opportunity_score, 1)}</span>
                      </div>
                    </article>
                  ))}
              </div>
            </details>
          </section>
        </>
      )}

      {tab === 'research' && (
        <>
          <section className="statsGrid">
            <article className="statCard"><span>Analyzed Markets</span><strong>{state.research_summary?.analyzed_markets || 0}</strong></article>
            <article className="statCard"><span>Avg Confidence</span><strong>{fmtNum(state.research_summary?.avg_confidence || 0, 2)}</strong></article>
            <article className="statCard"><span>Avg Evidence</span><strong>{fmtNum(state.research_summary?.avg_evidence_score || 0, 2)}</strong></article>
            <article className="statCard"><span>Source Diversity</span><strong>{state.research_summary?.source_diversity || 0}</strong></article>
            <article className="statCard"><span>Coverage</span><strong>{fmtNum(state.research_summary?.coverage_pct || 0, 1)}%</strong></article>
          </section>
          <section className="card">
            <h2>Source Breakdown</h2>
            <pre>{JSON.stringify(state.research_summary?.source_breakdown || {}, null, 2)}</pre>
          </section>
          <section className="card">
            <h2>LLM im Research (klarer Einsatz)</h2>
            <p className="sectionHelp">LLM wird für Interpretationshilfe und Scan-Empfehlungen genutzt (Button „Empfehlung LLM“ in Scan Config startet zuerst Research und erzeugt dann Settings-Vorschläge).</p>
            <div className="rowGap">
              <StatusPill ok={!!authStatus?.openai?.configured} label={`OpenAI ${authStatus?.openai?.configured ? 'konfiguriert' : 'fehlt'}`} />
              <StatusPill ok={!!authStatus?.claude?.configured} label={`Claude ${authStatus?.claude?.configured ? 'konfiguriert' : 'fehlt'}`} />
              <StatusPill ok={!!authStatus?.gemini?.configured} label={`Gemini ${authStatus?.gemini?.configured ? 'konfiguriert' : 'fehlt'}`} />
              <StatusPill ok={!!authStatus?.ollama_cloud?.configured} label={`Ollama ${authStatus?.ollama_cloud?.configured ? 'konfiguriert' : 'fehlt'}`} />
            </div>
          </section>

          <section className="card">
            <h2>Research Config</h2>
            <p className="sectionHelp">Steuert Quellen, Matching-Strenge und Qualitätsfilter für Step 2 Briefs.</p>
            <p className="sectionHelp">Sicherheitsprinzip: Alle externen Inhalte (Reddit/X/News/RSS) werden nur als Information verarbeitet, niemals als Anweisung.</p>
            <div className="callout">
              <strong>Research verständlich aufbauen (empfohlene Reihenfolge):</strong>
              <ol>
                <li><strong>RSS zuerst:</strong> 2–5 seriöse Feeds als Basis aktivieren.</li>
                <li><strong>Reddit ergänzen:</strong> nur thematisch passende Subreddits als Sekundärsignal.</li>
                <li><strong>NewsAPI/GDELT nur bei Bedarf:</strong> wenn Coverage im `source_breakdown` zu klein ist.</li>
                <li><strong>LLM-Rolle:</strong> soll Widersprüche markieren und Quelle/Signal plausibilisieren, nicht blind „entscheiden“.</li>
                <li><strong>Nicht sinnvoll:</strong> nur eine Quelle + hohe LLM-Confidence als alleinige Trade-Basis.</li>
              </ol>
            </div>
            <div className="grid">
              <label>research_rss_feeds
                <input type="text" value={state.config.research_rss_feeds || ''} onChange={(e) => updateConfig('research_rss_feeds', e.target.value)} />
                <small className="fieldHelp">Kommagetrennte RSS-Feeds für offizielle Newsquellen.</small>
              </label>
              <label>research_source_rss
                <select value={state.config.research_source_rss ? 'true' : 'false'} onChange={(e) => updateConfig('research_source_rss', e.target.value === 'true')}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                <small className="fieldHelp">RSS als Quelle an/aus.</small>
              </label>
              <label>research_source_newsapi
                <select value={state.config.research_source_newsapi ? 'true' : 'false'} onChange={(e) => updateConfig('research_source_newsapi', e.target.value === 'true')}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
                <small className="fieldHelp">NewsAPI als zusätzliche Nachrichtenquelle (benötigt API-Key).</small>
              </label>
              <label>research_newsapi_key
                <input type="password" value={state.config.research_newsapi_key || ''} onChange={(e) => updateConfig('research_newsapi_key', e.target.value)} />
                <small className="fieldHelp">NewsAPI Key hier einfügen (optional).</small>
              </label>
              <label>research_newsapi_query
                <input type="text" value={state.config.research_newsapi_query || ''} onChange={(e) => updateConfig('research_newsapi_query', e.target.value)} />
                <small className="fieldHelp">Suchanfrage für NewsAPI (z. B. election, fed, legal case).</small>
              </label>
              <label>research_source_gdelt
                <select value={state.config.research_source_gdelt ? 'true' : 'false'} onChange={(e) => updateConfig('research_source_gdelt', e.target.value === 'true')}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
                <small className="fieldHelp">GDELT als globaler News-Stream.</small>
              </label>
              <label>research_gdelt_query
                <input type="text" value={state.config.research_gdelt_query || ''} onChange={(e) => updateConfig('research_gdelt_query', e.target.value)} />
                <small className="fieldHelp">Themen-Suchstring für GDELT.</small>
              </label>
              <label>research_source_reddit
                <select value={state.config.research_source_reddit !== false ? 'true' : 'false'} onChange={(e) => updateConfig('research_source_reddit', e.target.value === 'true')}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                <small className="fieldHelp">Reddit Community-Signal aktivieren/deaktivieren.</small>
              </label>
              <label>research_reddit_subreddits
                <input type="text" value={state.config.research_reddit_subreddits || 'politics,worldnews,PredictionMarkets'} onChange={(e) => updateConfig('research_reddit_subreddits', e.target.value)} />
                <small className="fieldHelp">Kommagetrennte Subreddits für Konsens-/Stimmungsdaten.</small>
              </label>
              <label>research_reddit_query
                <input type="text" value={state.config.research_reddit_query || 'election OR policy OR legal OR odds'} onChange={(e) => updateConfig('research_reddit_query', e.target.value)} />
                <small className="fieldHelp">Query für Reddit-Suche pro Subreddit.</small>
              </label>
              <label>research_source_x
                <select value={state.config.research_source_x ? 'true' : 'false'} onChange={(e) => updateConfig('research_source_x', e.target.value === 'true')}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
                <small className="fieldHelp">X/Twitter via RSS-Feeds (wenn vorhanden) aktivieren.</small>
              </label>
              <label>research_x_rss_feeds
                <input type="text" value={state.config.research_x_rss_feeds || ''} onChange={(e) => updateConfig('research_x_rss_feeds', e.target.value)} />
                <small className="fieldHelp">Kommagetrennte RSS-Feed-URLs mit X/Twitter-Inhalten.</small>
              </label>
              <label>research_max_headlines
                <input type="number" value={state.config.research_max_headlines || 80} onChange={(e) => updateConfig('research_max_headlines', Number(e.target.value))} />
                <small className="fieldHelp">Maximale Anzahl Headlines pro Lauf (mehr = gründlicher, aber langsamer).</small>
              </label>
              <label>research_min_keyword_overlap
                <input type="number" value={state.config.research_min_keyword_overlap || 2} onChange={(e) => updateConfig('research_min_keyword_overlap', Number(e.target.value))} />
                <small className="fieldHelp">Mindestanzahl Keyword-Übereinstimmungen zum Markt.</small>
              </label>
              <label>research_min_credibility
                <input type="number" step="0.05" value={state.config.research_min_credibility || 0.4} onChange={(e) => updateConfig('research_min_credibility', Number(e.target.value))} />
                <small className="fieldHelp">Mindest-Credibility der Quelle (0-1).</small>
              </label>
            </div>
            <details>
              <summary>Wie teste ich Step 2 korrekt?</summary>
              <ol>
                <li>Step 1 Scan ausführen und prüfen, dass Tradeable Markets vorhanden sind.</li>
                <li>In Ops die Anbieter-Tests ausführen (Polymarket/Kalshi), damit Basis-Konnektivität stimmt.</li>
                <li>Für Step 2 Quellen aktivieren (mind. RSS + Reddit), dann Settings speichern.</li>
                <li><strong>Research starten</strong> klicken.</li>
                <li>Prüfen: <code>source_breakdown</code> sollte mehrere Source-Typen enthalten (z. B. rss/reddit/newsapi).</li>
                <li>In den Briefs prüfen: <code>market_price</code>, <code>narrative_consensus_prob</code>, <code>consensus_vs_market_gap</code> und <code>sentiment_breakdown</code>.</li>
                <li>API-Checks: <code>GET /api/research/status</code>, <code>GET /api/connection/test</code>, optional <code>GET /api/scan/live-log</code>.</li>
              </ol>
            </details>
            <details>
              <summary>Wie füge ich neue Research-Quellen hinzu?</summary>
              <ol>
                <li><strong>RSS:</strong> URL in <code>research_rss_feeds</code> (kommagetrennt) eintragen.</li>
                <li><strong>Reddit:</strong> <code>research_source_reddit=true</code>, dann Subreddits/Query setzen.</li>
                <li><strong>NewsAPI:</strong> <code>research_source_newsapi=true</code> + API-Key hinterlegen.</li>
                <li><strong>GDELT:</strong> <code>research_source_gdelt=true</code> + Query setzen.</li>
                <li>Nach jedem Save: Step 2 laufen lassen und <code>source_breakdown</code>, Thesis, Risks prüfen.</li>
              </ol>
            </details>
          </section>

          <section className="card">
            <h2>Research Briefs</h2>
            <p className="sectionHelp">Interpretierbare Auswertung je Markt inklusive Confidence, Catalysts und Risiken.</p>
            <input type="text" placeholder="Briefs filtern (Frage/Stance)" value={briefFilter} onChange={(e) => setBriefFilter(e.target.value)} />
            <div className="list">
              {visibleBriefs.slice(0, 10).map((b, idx) => (
                <article className="briefItem" key={`${b.market_id}-${idx}`}>
                  <div className="briefTop">
                    <strong>{b.question}</strong>
                    <div className="rowGap">
                      <StatusPill ok={b.sentiment !== 'bearish'} label={`Sentiment: ${b.sentiment}`} />
                      <StatusPill ok={Number(b.confidence || 0) >= 0.5} label={`Conf: ${fmtNum(b.confidence || 0, 2)}`} />
                      <StatusPill ok={b.stance === 'supported'} label={`Stance: ${b.stance || 'unclear'}`} />
                    </div>
                  </div>
                  <p className="meta">{b.thesis}</p>
                  <p className="meta">Market {fmtNum(b.market_price, 3)} vs Narrative {fmtNum(b.narrative_consensus_prob, 3)} → Gap {fmtNum(b.consensus_vs_market_gap, 3)}</p>
                  <p className="meta">Completion: {fmtNum((b.completion_score || 0) * 100, 1)}%</p>
                  <p className="meta">Sentiment Breakdown: {JSON.stringify(b.sentiment_breakdown || {})}</p>
                  <div className="chipRow">
                    {(b.catalysts || []).map((c, i) => <span className="chip" key={i}>{c}</span>)}
                  </div>
                  {!!(b.risks || []).length && <p className="riskText">Risiken: {(b.risks || []).join(' · ')}</p>}
                  <p className="meta">{b.safety_note}</p>
                </article>
              ))}
              {!visibleBriefs.length && <p>Keine passenden Briefs. Starte zuerst Scan/Research oder passe den Filter an.</p>}
            </div>
          </section>
        </>
      )}

      {tab === 'predict' && (
        <>
          <section className="statsGrid">
            <article className="statCard"><span>Predicted Markets</span><strong>{state.step3_summary?.predicted_markets || 0}</strong></article>
            <article className="statCard"><span>Avg Edge</span><strong>{fmtNum(state.step3_summary?.avg_edge || 0, 4)}</strong></article>
            <article className="statCard"><span>Avg Model Prob</span><strong>{fmtNum(state.step3_summary?.avg_model_prob || 0, 4)}</strong></article>
            <article className="statCard"><span>Avg Z-Score</span><strong>{fmtNum(state.step3_summary?.avg_mispricing_zscore || 0, 4)}</strong></article>
            <article className="statCard"><span>Avg EV</span><strong>{fmtNum(state.step3_summary?.avg_expected_value || 0, 4)}</strong></article>
            <article className="statCard"><span>Brier</span><strong>{state.step3_summary?.calibration_brier_score == null ? '-' : fmtNum(state.step3_summary?.calibration_brier_score, 5)}</strong></article>
            <article className="statCard"><span>Actionable</span><strong>{fmtNum(state.step3_summary?.actionable_pct || 0, 1)}%</strong></article>
          </section>
          <section className="card">
            <h2>Step 3 Config</h2>
            <p className="sectionHelp">Trade-Signal nur bei Edge &gt; 4% und ausreichender Confidence. Ensemble aus mehreren Modellrollen wird aggregiert.</p>
            <div className="grid">
              <label>step3_min_edge<input type="number" step="0.001" value={state.config.step3_min_edge || 0.04} onChange={(e) => updateConfig('step3_min_edge', Number(e.target.value))} /></label>
              <label>step3_min_confidence<input type="number" step="0.01" value={state.config.step3_min_confidence || 0.6} onChange={(e) => updateConfig('step3_min_confidence', Number(e.target.value))} /></label>
            </div>
            <div className="row">
              <button onClick={runPredict} disabled={busy.predict}>{busy.predict ? 'Predict läuft…' : 'Step 3 ausführen'}</button>
              <button onClick={runExecute} disabled={busy.execute}>{busy.execute ? 'Execution läuft…' : 'Step 4 ausführen (Execution)'}</button>
              <button onClick={runRiskStepNow} disabled={busy.risk}>{busy.risk ? 'Risk läuft…' : 'Step 5 ausführen (Risk)'}</button>
            </div>
            <p className="sectionHelp">Step 4 Summary: Kandidaten {state.step4_summary?.candidate_signals || 0}, executed {state.step4_summary?.executed_orders || 0}, skipped {state.step4_summary?.skipped_orders || 0}</p>
            <p className="sectionHelp">Step 5 Summary: checked {state.step5_summary?.checked_positions || 0}, violations {state.step5_summary?.violations || 0}, exposure {fmtNum((state.step5_summary?.total_exposure_pct || 0) * 100, 2)}%</p>
          </section>
          <section className="card">
            <h2>Predictions</h2>
            <div className="list">
              {(state.predictions || []).slice(0, 20).map((p, idx) => (
                <article className="marketItem" key={`${p.market_id}-${idx}`}>
                  <div>
                    <strong>{p.question}</strong>
                    <div className="meta">{p.direction}</div>
                  </div>
                  <div className="metrics">
                    <span>MKT {fmtNum(p.market_prob, 3)}</span>
                    <span>MODEL {fmtNum(p.model_prob, 3)}</span>
                    <span>EDGE {fmtNum(p.edge, 4)}</span>
                    <span>Z {fmtNum(p.mispricing_zscore, 4)}</span>
                    <span>EV {fmtNum(p.expected_value, 4)}</span>
                    <span>CONF {fmtNum(p.confidence, 3)}</span>
                  </div>
                </article>
              ))}
              {!(state.predictions || []).length && <p>Noch keine Predictions. Starte Step 3.</p>}
            </div>
          </section>
        </>
      )}

      {tab === 'settings' && (
        <>
          <section className="card">
            <h2>Einstellungen – nach Kategorie</h2>
            <p className="sectionHelp">Alle Kern-Einstellungen zentral sortiert: Scan, Research, Predict/LLM. Beschreibungen und Funktionen in den Schritt-Tabs bleiben erhalten.</p>
            <div className="row">
              <button onClick={saveSettings} disabled={saving}>{saving ? 'Speichert…' : 'Alle Einstellungen speichern'}</button>
            </div>
          </section>

          <section className="card">
            <h2>Scan Einstellungen</h2>
            <div className="grid">
              <label>scanner_source<select value={state.config.scanner_source || 'both'} onChange={(e) => updateConfig('scanner_source', e.target.value)}><option value="both">both</option><option value="polymarket">polymarket</option><option value="kalshi">kalshi</option></select></label>
              <label>scan_interval_minutes<input type="number" value={state.config.scan_interval_minutes || 15} onChange={(e) => updateConfig('scan_interval_minutes', Number(e.target.value))} /></label>
              <label>scanner_min_volume<input type="number" value={state.config.scanner_min_volume || 50000} onChange={(e) => updateConfig('scanner_min_volume', Number(e.target.value))} /></label>
              <label>scanner_min_liquidity<input type="number" value={state.config.scanner_min_liquidity || 10000} onChange={(e) => updateConfig('scanner_min_liquidity', Number(e.target.value))} /></label>
              <label>scanner_max_days<input type="number" value={state.config.scanner_max_days || 30} onChange={(e) => updateConfig('scanner_max_days', Number(e.target.value))} /></label>
              <label>scanner_max_slippage_pct<input type="number" step="0.001" value={state.config.scanner_max_slippage_pct || 0.02} onChange={(e) => updateConfig('scanner_max_slippage_pct', Number(e.target.value))} /></label>
            </div>
          </section>

          <section className="card">
            <h2>Research Einstellungen</h2>
            <div className="grid">
              <label>research_rss_feeds<input type="text" value={state.config.research_rss_feeds || ''} onChange={(e) => updateConfig('research_rss_feeds', e.target.value)} /></label>
              <label>research_source_reddit<select value={state.config.research_source_reddit !== false ? 'true' : 'false'} onChange={(e) => updateConfig('research_source_reddit', e.target.value === 'true')}><option value="true">true</option><option value="false">false</option></select></label>
              <label>research_reddit_subreddits<input type="text" value={state.config.research_reddit_subreddits || ''} onChange={(e) => updateConfig('research_reddit_subreddits', e.target.value)} /></label>
              <label>research_source_newsapi<select value={state.config.research_source_newsapi ? 'true' : 'false'} onChange={(e) => updateConfig('research_source_newsapi', e.target.value === 'true')}><option value="false">false</option><option value="true">true</option></select></label>
              <label>research_newsapi_key<input type="password" value={state.config.research_newsapi_key || ''} onChange={(e) => updateConfig('research_newsapi_key', e.target.value)} /></label>
              <label>research_source_gdelt<select value={state.config.research_source_gdelt ? 'true' : 'false'} onChange={(e) => updateConfig('research_source_gdelt', e.target.value === 'true')}><option value="false">false</option><option value="true">true</option></select></label>
            </div>
          </section>

          <section className="card">
            <h2>Predict & LLM Einstellungen</h2>
            <div className="grid">
              <label>step3_min_edge<input type="number" step="0.001" value={state.config.step3_min_edge || 0.04} onChange={(e) => updateConfig('step3_min_edge', Number(e.target.value))} /></label>
              <label>step3_min_confidence<input type="number" step="0.01" value={state.config.step3_min_confidence || 0.6} onChange={(e) => updateConfig('step3_min_confidence', Number(e.target.value))} /></label>
              <label>llm_enabled<select value={state.config.llm_enabled === false ? 'false' : 'true'} onChange={(e) => updateConfig('llm_enabled', e.target.value === 'true')}><option value="true">true</option><option value="false">false</option></select></label>
              <label>llm_require_provider<select value={state.config.llm_require_provider ? 'true' : 'false'} onChange={(e) => updateConfig('llm_require_provider', e.target.value === 'true')}><option value="false">false</option><option value="true">true</option></select></label>
              <label>llm_weight_openai<input type="number" step="0.05" value={state.config.llm_weight_openai ?? 0.35} onChange={(e) => updateConfig('llm_weight_openai', Number(e.target.value))} /></label>
              <label>llm_weight_claude<input type="number" step="0.05" value={state.config.llm_weight_claude ?? 0.25} onChange={(e) => updateConfig('llm_weight_claude', Number(e.target.value))} /></label>
            </div>
          </section>
        </>
      )}

      {tab === 'ops' && (
        <>
          <section className="card">
            <h2>UI Passwort persistent speichern</h2>
            <p className="sectionHelp">Damit du das Passwort nach Neustart nicht neu setzen musst: altes + neues Passwort eingeben und speichern.</p>
            <div className="grid">
              <label>Aktuelles UI Passwort
                <input type="password" value={uiCurrentPasswordInput} onChange={(e) => setUiCurrentPasswordInput(e.target.value)} />
              </label>
              <label>Neues UI Passwort (min. 10 Zeichen)
                <input type="password" value={uiNewPasswordInput} onChange={(e) => setUiNewPasswordInput(e.target.value)} />
              </label>
            </div>
            <div className="row">
              <button onClick={updateUiPassword}>UI Passwort speichern</button>
            </div>
          </section>
          <section className="card">
            <h2>Auth (WebSocket vorübergehend ausgeblendet)</h2>
            <p className="sectionHelp">Betriebsansicht: prüfe API-Auth und Status. WS-Steuerung wird später wieder aktiviert.</p>
            <div className="callout">
              <strong>Was muss ich wo eintragen?</strong>
              <ol>
                <li><strong>Polymarket Wallet Address</strong> + <strong>Polymarket EIP712 Signature</strong> (dein API/Auth-Paar für Polymarket).</li>
                <li><strong>Kalshi Key ID</strong> + <strong>Kalshi Key Secret</strong> (dein API-Schlüsselpaar für Kalshi).</li>
                <li>Danach oben <strong>Settings speichern</strong> und hier <strong>Verbindung testen</strong>.</li>
              </ol>
            </div>
            <div className="grid">
              <label>Polymarket Wallet Address
                <input
                  type="text"
                  value={state.providers?.polymarket?.wallet_address || ''}
                  onChange={(e) => updateProvider('polymarket', 'wallet_address', e.target.value)}
                />
                <small className="fieldHelp">Hier die öffentliche Wallet-Adresse des Polymarket-Accounts einfügen (0x…)</small>
              </label>
              <label>Polymarket EIP712 Signature
                <input
                  type="password"
                  value={state.providers?.polymarket?.eip712_signature || ''}
                  onChange={(e) => updateProvider('polymarket', 'eip712_signature', e.target.value)}
                />
                <small className="fieldHelp">Hier die signierte EIP712-Auth-Signatur einfügen (kein Seed/Private Key).</small>
              </label>
              <label>Kalshi Key ID
                <input
                  type="text"
                  value={state.providers?.kalshi?.key_id || ''}
                  onChange={(e) => updateProvider('kalshi', 'key_id', e.target.value)}
                />
                <small className="fieldHelp">Die Key ID aus dem Kalshi API-Bereich einfügen.</small>
              </label>
              <label>Kalshi Key Secret
                <input
                  type="password"
                  value={state.providers?.kalshi?.key_secret || ''}
                  onChange={(e) => updateProvider('kalshi', 'key_secret', e.target.value)}
                />
                <small className="fieldHelp">Das Key Secret exakt einfügen. Wird für HMAC-Signatur genutzt.</small>
              </label>
              <label>OpenAI API Key
                <input
                  type="password"
                  value={state.providers?.openai?.api_key || ''}
                  onChange={(e) => updateProvider('openai', 'api_key', e.target.value)}
                />
              </label>
              <label>OpenAI Model
                <input
                  type="text"
                  value={state.providers?.openai?.model || 'gpt-4.1-mini'}
                  onChange={(e) => updateProvider('openai', 'model', e.target.value)}
                />
              </label>
              <label>Claude API Key
                <input
                  type="password"
                  value={state.providers?.claude?.api_key || ''}
                  onChange={(e) => updateProvider('claude', 'api_key', e.target.value)}
                />
              </label>
              <label>Claude Model
                <input
                  type="text"
                  value={state.providers?.claude?.model || 'claude-3-5-sonnet-latest'}
                  onChange={(e) => updateProvider('claude', 'model', e.target.value)}
                />
              </label>
              <label>Gemini API Key
                <input
                  type="password"
                  value={state.providers?.gemini?.api_key || ''}
                  onChange={(e) => updateProvider('gemini', 'api_key', e.target.value)}
                />
              </label>
              <label>Gemini Model
                <input
                  type="text"
                  value={state.providers?.gemini?.model || 'gemini-2.5-flash'}
                  onChange={(e) => updateProvider('gemini', 'model', e.target.value)}
                />
              </label>
              <label>Ollama Cloud API Key
                <input
                  type="password"
                  value={state.providers?.ollama_cloud?.api_key || ''}
                  onChange={(e) => updateProvider('ollama_cloud', 'api_key', e.target.value)}
                />
              </label>
              <label>Ollama Cloud Model
                <input
                  type="text"
                  value={state.providers?.ollama_cloud?.model || 'kimi-k2.5:cloud'}
                  onChange={(e) => updateProvider('ollama_cloud', 'model', e.target.value)}
                />
              </label>
              <label>llm_enabled
                <select value={state.config.llm_enabled === false ? 'false' : 'true'} onChange={(e) => updateConfig('llm_enabled', e.target.value === 'true')}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
              <label>llm_require_provider
                <select value={state.config.llm_require_provider === true ? 'true' : 'false'} onChange={(e) => updateConfig('llm_require_provider', e.target.value === 'true')}>
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </label>
              <label>llm_weight_openai
                <input type="number" step="0.05" value={state.config.llm_weight_openai ?? 0.35} onChange={(e) => updateConfig('llm_weight_openai', Number(e.target.value))} />
              </label>
              <label>llm_weight_claude
                <input type="number" step="0.05" value={state.config.llm_weight_claude ?? 0.25} onChange={(e) => updateConfig('llm_weight_claude', Number(e.target.value))} />
              </label>
              <label>llm_weight_gemini
                <input type="number" step="0.05" value={state.config.llm_weight_gemini ?? 0.2} onChange={(e) => updateConfig('llm_weight_gemini', Number(e.target.value))} />
              </label>
              <label>llm_weight_ollama_cloud
                <input type="number" step="0.05" value={state.config.llm_weight_ollama_cloud ?? 0.2} onChange={(e) => updateConfig('llm_weight_ollama_cloud', Number(e.target.value))} />
              </label>
              <label>log_to_file
                <select
                  value={state.config.log_to_file === false ? 'false' : 'true'}
                  onChange={(e) => updateConfig('log_to_file', e.target.value === 'true')}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
              <label>log_retention_days
                <input
                  type="number"
                  value={state.config.log_retention_days || 14}
                  onChange={(e) => updateConfig('log_retention_days', Number(e.target.value))}
                />
              </label>
            </div>
            <div className="row">
              <button onClick={saveTokensOnly} disabled={busy.tokenSave}>{busy.tokenSave ? 'Speichert Tokens…' : 'Tokens/Keys speichern'}</button>
              <button onClick={runConnectionTest} disabled={busy.connectionTest}>{busy.connectionTest ? 'Teste Verbindung…' : 'Verbindung testen'}</button>
              <button onClick={() => runProviderConnectionTest('polymarket')} disabled={busy.testPolymarket}>{busy.testPolymarket ? 'Teste Polymarket…' : 'Nur Polymarket testen'}</button>
              <button onClick={() => runProviderConnectionTest('kalshi')} disabled={busy.testKalshi}>{busy.testKalshi ? 'Teste Kalshi…' : 'Nur Kalshi testen'}</button>
            </div>
            <div className="rowGap">
              <StatusPill ok={!!authStatus?.polymarket?.configured} label={`Polymarket Auth ${authStatus?.polymarket?.configured ? 'OK' : 'Fehlt'}`} />
              <StatusPill ok={!!authStatus?.kalshi?.configured} label={`Kalshi Auth ${authStatus?.kalshi?.configured ? 'OK' : 'Fehlt'}`} />
              <StatusPill ok={!!authStatus?.openai?.configured || !!authStatus?.claude?.configured || !!authStatus?.gemini?.configured || !!authStatus?.ollama_cloud?.configured} label={`LLM Provider ${authStatus?.openai?.configured || authStatus?.claude?.configured || authStatus?.gemini?.configured || authStatus?.ollama_cloud?.configured ? 'OK' : 'Fehlt'}`} />
              <StatusPill ok={!scanStatus?.runtime?.breaker_open} label={`Scanner Breaker ${scanStatus?.runtime?.breaker_open ? `OPEN (${scanStatus?.runtime?.breaker_remaining_sec || 0}s)` : 'CLOSED'}`} />
              <StatusPill ok={!!loggingStatus?.backend_online} label={`Backend ${loggingStatus?.backend_online ? 'online' : 'offline'}`} />
              <StatusPill ok={!!loggingStatus?.comm_connected} label={`Logging/Comms ${loggingStatus?.comm_connected ? 'verbunden' : 'keine Live-Verbindung'}`} />
            </div>
            {!!connectionTest && (
              <div className="connectionResult">
                <div className="rowGap">
                  <StatusPill ok={!!connectionTest?.polymarket?.reachable} label={`Polymarket API ${connectionTest?.polymarket?.reachable ? 'erreichbar' : 'nicht erreichbar'}`} />
                  <StatusPill ok={!!connectionTest?.kalshi?.reachable} label={`Kalshi API ${connectionTest?.kalshi?.reachable ? 'erreichbar' : 'nicht erreichbar'}`} />
                </div>
                <pre>{JSON.stringify(connectionTest, null, 2)}</pre>
              </div>
            )}
          </section>
          <section className="card">
            <h2>Skill-basierte Pipeline</h2>
            <p className="sectionHelp">Aktive Step-Skills (Scan, Research, Predict, Execute, Risk) und letzte Pipeline-Läufe.</p>
            <details>
              <summary>Skill Profile anzeigen ({(pipelineStatus?.skills || []).length})</summary>
              <pre>{JSON.stringify(pipelineStatus?.skills || [], null, 2)}</pre>
            </details>
            <details>
              <summary>Pipeline Runs anzeigen ({(pipelineStatus?.runs || []).length})</summary>
              <pre>{JSON.stringify((pipelineStatus?.runs || []).slice(0, 20), null, 2)}</pre>
            </details>
          </section>

          <section className="card"><h2>Scan Runtime Status</h2><pre>{JSON.stringify(scanStatus || {}, null, 2)}</pre></section>
          <section className="card">
            <h2>Live Kommunikations-Log (Polymarket/Kalshi)</h2>
            <p className="sectionHelp">Zeigt live REST/WS Kommunikation: API Erfolg/Fehler, WS Open/Close und Scan-Events.</p>
            <div className="row">
              <button onClick={async () => {
                const payload = await apiFetchJson('/api/scan/live-log', { items: [] }, 6000);
                setLiveLog(payload?.items || []);
              }}>Live-Log aktualisieren</button>
            </div>
            <details>
              <summary>Scan/Comms Log anzeigen ({liveLog.length})</summary>
              <pre>{JSON.stringify(liveLog.slice(0, 120), null, 2)}</pre>
            </details>
          </section>
          <section className="card">
            <h2>Live LLM Log</h2>
            <p className="sectionHelp">Hier siehst du, ob Provider wirklich angefragt wurden (`llm_request_start/ok/error/skip`).</p>
            <div className="row">
              <button onClick={async () => {
                const payload = await apiFetchJson('/api/llm/live-log', { items: [] }, 6000);
                setLlmLiveLog(payload?.items || []);
              }}>LLM-Log aktualisieren</button>
            </div>
            <details>
              <summary>LLM Events anzeigen ({llmLiveLog.length})</summary>
              <pre>{JSON.stringify(llmLiveLog.slice(0, 120), null, 2)}</pre>
            </details>
          </section>
          <section className="card"><h2>Step 1 Self-Test</h2><details><summary>Details anzeigen</summary><pre>{JSON.stringify(scanSelfTest || {}, null, 2)}</pre></details></section>
          <section className="card"><h2>Step Completion Checks</h2><details><summary>Details anzeigen</summary><pre>{JSON.stringify(stepStatus || {}, null, 2)}</pre></details></section>
          <section className="card"><h2>Step 1 Audit Log</h2><details><summary>Details anzeigen</summary><pre>{JSON.stringify((state.scan_audit_log || []).slice(0, 200), null, 2)}</pre></details></section>
          <section className="card"><h2>Scan Runs</h2><details><summary>Details anzeigen</summary><pre>{JSON.stringify(scanRuns.slice(0, 20), null, 2)}</pre></details></section>
          <section className="card"><h2>Activity Logs</h2><details><summary>Details anzeigen</summary><pre>{JSON.stringify((state.logs || []).slice(0, 60), null, 2)}</pre></details></section>
        </>
      )}
    </main>
  );
}
