// index.js — Slim entry point: Express setup + route registration
//
// Module map (refactored from 2,200-line monolith):
//   utils.js      — HTTP retry, JSON parsing, sentiment, live comm log
//   auth.js       — UI password auth + middleware
//   appState.js   — State persistence (unchanged)
//   platforms.js  — Polymarket + Kalshi API clients
//   websockets.js — WebSocket management
//   scanner.js    — Market scanning, filtering, ranking, scheduling
//   research.js   — Multi-source research pipeline
//   predict.js    — LLM ensemble + prediction step
//   execution.js  — Order execution + paper trading
//   riskEngine.js — Risk validation step
//   pipeline.js   — Full pipeline orchestration + step status
//   config.js     — Config sanitization + presets
//   scanCore.js   — Pure scan helpers (unchanged)
//   tradeEngine.js — Position sizing helpers (unchanged)
//   stepRegistry.js — Skill profile loader (unchanged)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { loadState, saveState, logLine, buildScannerHealth, maskProviderKeys, nextId, defaultState } from './appState.js';
import { loadSkillProfiles } from './stepRegistry.js';
import { liveCommLog } from './utils.js';
import { computeBrierCalibration } from './utils.js';
import { registerAuthRoutes } from './auth.js';
import { buildPolymarketAuthHeaders, buildKalshiAuthHeaders, runPolymarketConnectionTest, runKalshiConnectionTest } from './platforms.js';
import { websocketState, flushWsTicksBuffer, applyWebsocketConfig, stopWebsocket } from './websockets.js';
import { scannerRuntime, scanAudit, runScanCycle, onScanFailure, ensureScanScheduler, scanAndRankMarkets } from './scanner.js';
import { runResearchStep } from './research.js';
import { runPredictStep, recordPredictionOutcomes, testLlmProvider, getProviderHealth } from './predict.js';
import { runExecutionStep } from './execution.js';
import { runRiskStep } from './riskEngine.js';
import { runSkillPipeline, computeStepStatus, computeStep1Readiness, runStep1SelfTest, buildHeuristicScanRecommendation, buildImprovementReport } from './pipeline.js';
import { sanitizeConfigPatch, buildStep1ProductionPreset } from './config.js';

const execFileAsync = promisify(execFile);
const app = express();
app.use(cors());
app.use(express.json());
const port = Number(process.env.PORT || 8080);

// Initialize state
if (!loadState().config) saveState(defaultState());

// Auth routes + middleware
registerAuthRoutes(app);

import { detectCorrelatedGroups } from './correlatedMarkets.js';

// --- Health ---
app.get('/api/health', (_, res) => res.json({ status: 'ok', mode: 'modular' }));

// --- State ---
app.get('/api/state', (_, res) => {
  const state = loadState();
  state.scanner_health = buildScannerHealth(state.markets || [], state.config || {});
  state.websocket = websocketState;
  state.step_status = computeStepStatus(state);
  res.json(maskProviderKeys(state));
});

// --- Scan ---
app.get('/api/scan', (_, res) => { const s = loadState(); res.json({ scannedAt: s.scan_runs?.[0]?.time || null, markets: s.scan_results || [], runs: s.scan_runs || [] }); });
app.post('/api/scan/run', async (_, res) => {
  try { const { ranked, added, source, state } = await runScanCycle({ force: true }); const selfTest = runStep1SelfTest(state); res.json({ ok: true, source, added, tradeable_count: ranked.length, top: ranked.slice(0, 20), scanner_health: buildScannerHealth(state.markets || [], state.config || {}), self_test: selfTest, step_status: computeStepStatus(state) }); }
  catch (e) { const s = loadState(); onScanFailure(e, s.config || {}); scanAudit(s, 'scan_failed_manual', { error: e.message }); saveState(s); res.status(500).json({ ok: false, message: e.message }); }
});
app.get('/api/scan/status', (_, res) => { const now = Date.now(); res.json({ runtime: { ...scannerRuntime, breaker_open: scannerRuntime.breakerUntil > now, breaker_remaining_sec: scannerRuntime.breakerUntil > now ? Math.ceil((scannerRuntime.breakerUntil - now) / 1000) : 0 }, last_run: (loadState().scan_runs || [])[0] || null }); });
app.get('/api/scan/self-test', (_, res) => res.json(runStep1SelfTest(loadState())));
app.get('/api/scan/live-log', (_, res) => { const latest = liveCommLog[0] || null; res.json({ ok: true, total: liveCommLog.length, connected: Boolean(latest && (Date.now() - new Date(latest.t).getTime()) <= 120000), items: liveCommLog.slice(0, 200) }); });

// --- Research ---
app.post('/api/research/run', async (_, res) => { try { res.json({ ok: true, ...await runResearchStep() }); } catch (e) { res.status(500).json({ ok: false, message: e.message }); } });
app.get('/api/research/status', (_, res) => { const s = loadState(); res.json({ summary: s.research_summary || {}, briefs: (s.research_briefs || []).slice(0, 20) }); });
app.get('/api/research/test-sources', async (_, res) => {
  const state = loadState(); const cfg = state.config || {}; const results = {};
  // Test RSS
  if (cfg.research_source_rss !== false) {
    const feeds = String(cfg.research_rss_feeds || '').split(',').map(x => x.trim()).filter(Boolean);
    results.rss = { configured: feeds.length > 0, feeds_count: feeds.length, tested: [] };
    for (const feed of feeds.slice(0, 3)) {
      try {
        const r = await fetchWithRetry(feed, {}, { label: 'rss-test', retries: 0, timeoutMs: 6000 });
        const text = await r.text();
        const items = (text.match(/<item/gi) || []).length;
        results.rss.tested.push({ url: feed.slice(0, 80), ok: true, items });
      } catch (e) { results.rss.tested.push({ url: feed.slice(0, 80), ok: false, error: e.message }); }
    }
  } else { results.rss = { configured: false }; }
  // Test Reddit
  if (cfg.research_source_reddit !== false) {
    try {
      const r = await fetchWithRetry('https://www.reddit.com/r/PredictionMarkets/hot.json?limit=3', { headers: { 'User-Agent': 'tradingbot/test' } }, { label: 'reddit-test', retries: 0, timeoutMs: 6000 });
      const json = await r.json();
      const posts = json?.data?.children?.length || 0;
      results.reddit = { configured: true, ok: true, posts };
    } catch (e) { results.reddit = { configured: true, ok: false, error: e.message }; }
  } else { results.reddit = { configured: false }; }
  // Test NewsAPI
  if (cfg.research_source_newsapi && String(cfg.research_newsapi_key || '').trim()) {
    try {
      const r = await fetchWithRetry(`https://newsapi.org/v2/everything?q=prediction+market&pageSize=1&language=en`, { headers: { 'X-Api-Key': cfg.research_newsapi_key } }, { label: 'newsapi-test', retries: 0, timeoutMs: 6000 });
      const json = await r.json();
      results.newsapi = { configured: true, ok: json.status === 'ok', total: json.totalResults || 0 };
    } catch (e) { results.newsapi = { configured: true, ok: false, error: e.message }; }
  } else { results.newsapi = { configured: false }; }
  // Test GDELT
  if (cfg.research_source_gdelt) {
    try {
      const r = await fetchWithRetry('https://api.gdeltproject.org/api/v2/doc/doc?query=prediction+market&mode=ArtList&maxrecords=3&format=json', {}, { label: 'gdelt-test', retries: 0, timeoutMs: 6000 });
      const json = await r.json();
      results.gdelt = { configured: true, ok: true, articles: (json?.articles || []).length };
    } catch (e) { results.gdelt = { configured: true, ok: false, error: e.message }; }
  } else { results.gdelt = { configured: false }; }
  res.json({ ok: true, results });
});
app.post('/api/research/scan-recommendations', async (req, res) => {
  try {
    if (req.body?.run_research !== false) await runResearchStep();
    const state = loadState();
    const heuristic = buildHeuristicScanRecommendation(state);
    res.json({ ok: true, heuristic, note: 'use heuristic recommendation' });
  } catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

// --- Predict ---
app.post('/api/predict/run', async (_, res) => { try { res.json({ ok: true, ...await runPredictStep(loadState()) }); } catch (e) { res.status(500).json({ ok: false, message: e.message }); } });
app.get('/api/predict/status', (_, res) => { const s = loadState(); res.json({ summary: s.step3_summary || {}, predictions: (s.predictions || []).slice(0, 20), correlations: s.correlations || [], calibration: computeBrierCalibration(s.prediction_outcomes || []) }); });
// predict/outcomes moved below with Brier Score auto-calc
app.get('/api/predict/calibration', (_, res) => { const s = loadState(); res.json({ ok: true, ...computeBrierCalibration(s.prediction_outcomes || []) }); });
app.get('/api/predict/correlations', (_, res) => { const s = loadState(); res.json({ ok: true, ...detectCorrelatedGroups(s.predictions || []) }); });

// --- Execute ---
app.post('/api/execute/run', async (_, res) => { try { res.json({ ok: true, ...await runExecutionStep(loadState()) }); } catch (e) { res.status(500).json({ ok: false, message: e.message }); } });
app.get('/api/execute/status', (_, res) => { const s = loadState(); res.json({ summary: s.step4_summary || {}, orders: (s.orders || []).slice(0, 100) }); });

// --- Risk ---
app.post('/api/risk/run', async (_, res) => { try { res.json({ ok: true, ...await runRiskStep(loadState()) }); } catch (e) { res.status(500).json({ ok: false, message: e.message }); } });
app.get('/api/risk/status', (_, res) => { const s = loadState(); res.json({ summary: s.step5_summary || {}, violations: s.risk?.last_risk_checks || [] }); });
app.post('/api/risk/validate', async (req, res) => {
  try { const { stdout } = await execFileAsync('python3', ['predict-market-bot/scripts/validate_risk.py', '--json', JSON.stringify(req.body || {})]); res.json(JSON.parse(stdout)); }
  catch (e) { res.status(500).json({ error: 'risk_validation_failed', detail: e.message }); }
});

// --- Pipeline ---
app.post('/api/pipeline/run', async (req, res) => { try { const f = req.body || {}; res.json({ ok: true, ...await runSkillPipeline({ runScan: f.run_scan !== false, runResearch: f.run_research !== false, runPredict: f.run_predict !== false, runExecute: f.run_execute !== false, runRisk: f.run_risk !== false }) }); } catch (e) { res.status(500).json({ ok: false, message: e.message }); } });
app.get('/api/pipeline/status', (_, res) => { const s = loadState(); res.json({ ok: true, latest: (s.pipeline_runs || [])[0] || null, step_status: computeStepStatus(s), skills: loadSkillProfiles() }); });
app.get('/api/status/steps', (_, res) => res.json(computeStepStatus(loadState())));
app.get('/api/improvements', (_, res) => res.json({ ok: true, ...buildImprovementReport(loadState()) }));
app.get('/api/skills', (_, res) => res.json({ ok: true, skills: loadSkillProfiles() }));

// --- Settings ---
app.post('/api/save', (req, res) => {
  const payload = req.body || {};
  const state = loadState();
  state.config = { ...state.config, ...sanitizeConfigPatch(payload.config || {}, state.config) };
  for (const [name, cfg] of Object.entries(payload.providers || {})) {
    state.providers[name] = state.providers[name] || {};
    for (const [key, value] of Object.entries(cfg || {})) {
      const sensitive = /key|secret|signature|token|pass/i.test(String(key));
      if (sensitive) { if (value && value !== '********') state.providers[name][key] = value; }
      else state.providers[name][key] = value;
    }
  }
  logLine(state, 'info', 'settings saved');
  saveState(state);
  ensureScanScheduler();
  ensurePipelineScheduler();
  applyWebsocketConfig();
  res.json({ ok: true });
});

app.post('/api/kill-switch', (req, res) => { const s = loadState(); s.config.kill_switch = Boolean(req.body?.enabled); logLine(s, s.config.kill_switch ? 'warning' : 'info', `kill switch ${s.config.kill_switch ? 'enabled' : 'disabled'}`); saveState(s); res.json({ ok: true, kill_switch: s.config.kill_switch }); });

app.post('/api/step1/finalize', async (_, res) => {
  try { const s = loadState(); s.config = { ...s.config, ...sanitizeConfigPatch(buildStep1ProductionPreset(), s.config || {}) }; saveState(s); const out = await runScanCycle({ force: true }); res.json({ ok: true, tradeable_count: out?.ranked?.length || 0, step1_progress_pct: computeStepStatus(loadState()).step1?.progress_pct || 0 }); }
  catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

app.post('/api/markets/reset', (req, res) => { const s = loadState(); const prev = s.markets.length; s.markets = []; s.scan_results = []; s.scan_runs = []; s.scan_history = {}; s.research_briefs = []; s.predictions = []; logLine(s, 'warning', 'markets reset'); saveState(s); res.json({ ok: true, previous_markets: prev }); });
app.post('/api/trades/reset', (req, res) => { const s = loadState(); const prev = (s.trades||[]).length; s.trades = []; s.signals = []; s.orders = []; s.execution_runs = []; s.step4_summary = { completed_at: null, candidate_signals:0, executed_orders:0, skipped_orders:0, opened_trades:0, risk_blocked_orders:0, paper_mode: true }; logLine(s, 'warning', `trades reset (${prev} deleted)`); saveState(s); res.json({ ok: true, previous_trades: prev }); });

// --- Connections ---
app.get('/api/connection/test', async (_, res) => { const cfg = loadState().config || {}; const pm = await runPolymarketConnectionTest(cfg); const ka = await runKalshiConnectionTest(cfg); res.status(pm.reachable || ka.reachable ? 200 : 503).json({ ok: pm.reachable || ka.reachable, polymarket: pm, kalshi: ka }); });
app.get('/api/connection/test/polymarket', async (_, res) => { const r = await runPolymarketConnectionTest(loadState().config || {}); res.status(r.reachable ? 200 : 503).json({ ok: r.reachable, ...r }); });
app.get('/api/connection/test/kalshi', async (_, res) => { const r = await runKalshiConnectionTest(loadState().config || {}); res.status(r.reachable ? 200 : 503).json({ ok: r.reachable, ...r }); });

// Exchange balance fetching
app.get('/api/balance', async (_, res) => {
  const state = loadState();
  const cfg = state.config || {};
  const balances = { polymarket: null, kalshi: null, total: null };

  // Kalshi balance
  try {
    const ka = buildKalshiAuthHeaders('/trade-api/v2/portfolio/balance');
    if (ka['KALSHI-ACCESS-KEY']) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch('https://trading-api.kalshi.com/trade-api/v2/portfolio/balance', { headers: ka, signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        balances.kalshi = { balance: Number(data.balance || 0) / 100, available: Number(data.available_balance || 0) / 100, payout: Number(data.payout || 0) / 100 };
      }
    }
  } catch (e) { balances.kalshi = { error: String(e.message || e).slice(0, 100) }; }

  // Polymarket - would need web3 wallet balance check
  // For now we track it from the state
  balances.polymarket = { note: 'Polymarket Balance braucht Web3 Wallet-Abfrage. Wird über Paper-Trading getrackt.' };

  // Total from Kalshi if available, otherwise from state
  const kalshiBal = balances.kalshi?.balance;
  if (kalshiBal != null && !balances.kalshi?.error) {
    balances.total = kalshiBal;
    // Auto-sync bankroll if configured
    if (cfg.auto_sync_bankroll && kalshiBal > 0) {
      state.config.bankroll = kalshiBal;
      logLine(state, 'info', `bankroll auto-synced from Kalshi: $${kalshiBal.toFixed(2)}`);
      saveState(state);
    }
  } else {
    balances.total = Number(cfg.bankroll || 0);
  }

  res.json({ ok: true, balances, synced: Boolean(cfg.auto_sync_bankroll && kalshiBal > 0) });
});

app.get('/api/sources/test', async (_, res) => {
  const cfg = loadState().config || {};
  const results = {};
  // RSS test
  if (cfg.research_source_rss !== false) {
    const feeds = String(cfg.research_rss_feeds || '').split(',').map(x => x.trim()).filter(Boolean);
    results.rss = { enabled: true, feeds_configured: feeds.length, feeds_tested: [] };
    for (const feed of feeds.slice(0, 3)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(feed, { signal: controller.signal, headers: { 'User-Agent': 'tradingbot/0.1' } });
        clearTimeout(timer);
        const text = await resp.text();
        const items = (text.match(/<item[\s\S]*?<\/item>/gi) || []).length;
        results.rss.feeds_tested.push({ url: feed.slice(0, 80), ok: true, items, status: resp.status });
      } catch (e) { results.rss.feeds_tested.push({ url: feed.slice(0, 80), ok: false, error: String(e.message || e).slice(0, 100) }); }
    }
    results.rss.working = results.rss.feeds_tested.some(f => f.ok && f.items > 0);
  } else { results.rss = { enabled: false, working: false }; }
  // Reddit test
  if (cfg.research_source_reddit !== false) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const resp = await fetch('https://www.reddit.com/r/PredictionMarkets/hot.json?limit=3', { signal: controller.signal, headers: { 'User-Agent': 'tradingbot/0.1' } });
      clearTimeout(timer);
      const json = await resp.json();
      const posts = json?.data?.children?.length || 0;
      results.reddit = { enabled: true, working: posts > 0, posts_found: posts, status: resp.status };
    } catch (e) { results.reddit = { enabled: true, working: false, error: String(e.message || e).slice(0, 100) }; }
  } else { results.reddit = { enabled: false, working: false }; }
  // NewsAPI test
  if (cfg.research_source_newsapi && String(cfg.research_newsapi_key || '').trim()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const resp = await fetch(`https://newsapi.org/v2/everything?q=prediction+market&pageSize=1&language=en`, { signal: controller.signal, headers: { 'X-Api-Key': cfg.research_newsapi_key } });
      clearTimeout(timer);
      const json = await resp.json();
      results.newsapi = { enabled: true, working: json.status === 'ok', total_results: json.totalResults || 0 };
    } catch (e) { results.newsapi = { enabled: true, working: false, error: String(e.message || e).slice(0, 100) }; }
  } else { results.newsapi = { enabled: Boolean(cfg.research_source_newsapi), working: false, key_missing: !String(cfg.research_newsapi_key || '').trim() }; }
  // GDELT test
  if (cfg.research_source_gdelt) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const resp = await fetch('https://api.gdeltproject.org/api/v2/doc/doc?query=prediction%20market&mode=ArtList&maxrecords=3&format=json', { signal: controller.signal });
      clearTimeout(timer);
      const json = await resp.json();
      results.gdelt = { enabled: true, working: (json.articles || []).length > 0, articles: (json.articles || []).length };
    } catch (e) { results.gdelt = { enabled: true, working: false, error: String(e.message || e).slice(0, 100) }; }
  } else { results.gdelt = { enabled: false, working: false }; }
  const anyWorking = Object.values(results).some(r => r.working);
  res.json({ ok: anyWorking, sources: results });
});

// LLM Provider connectivity test
app.get('/api/llm/test', async (_, res) => {
  const state = loadState();
  const cfg = state.config || {};
  const providers = state.providers || {};
  const results = {};
  const providerNames = ['openai', 'claude', 'gemini', 'ollama_cloud', 'local_ollama', 'kimi_direct'];
  for (const name of providerNames) {
    const p = providers[name] || {};
    if (!p.enabled) { results[name] = { enabled: false, ok: false }; continue; }
    results[name] = await testLlmProvider(name, p, cfg);
  }
  const anyOk = Object.values(results).some(r => r.ok);
  res.json({ ok: anyOk, providers: results, health: getProviderHealth() });
});

app.get('/api/auth/status', (_, res) => {
  const state = loadState();
  const llmOk = (name) => { const p = state.providers?.[name] || {}; return Boolean(p.enabled && p.api_key && p.model && p.base_url); };
  const pm = buildPolymarketAuthHeaders();
  const ka = buildKalshiAuthHeaders();
  res.json({ polymarket: { configured: Boolean(pm['x-pm-address'] && pm['x-pm-signature']) }, kalshi: { configured: Boolean(ka['KALSHI-ACCESS-KEY'] && ka['KALSHI-ACCESS-SIGNATURE']) }, openai: { configured: llmOk('openai') }, claude: { configured: llmOk('claude') }, gemini: { configured: llmOk('gemini') }, ollama_cloud: { configured: llmOk('ollama_cloud') } });
});

// --- WebSocket ---
app.post('/api/scanner/websocket/apply', (_, res) => { applyWebsocketConfig(); res.json({ ok: true, websocket: websocketState }); });
app.post('/api/scanner/websocket/stop', (_, res) => { stopWebsocket('polymarket'); stopWebsocket('kalshi'); res.json({ ok: true, websocket: websocketState }); });

// --- Logging ---
app.get('/api/llm/live-log', (_, res) => { const items = liveCommLog.filter((x) => String(x.event || '').startsWith('llm_')); res.json({ ok: true, total: items.length, items: items.slice(0, 200) }); });
app.get('/api/logging/connection-status', (_, res) => { const latest = liveCommLog[0] || null; res.json({ ok: true, backend_online: true, comm_connected: Boolean(latest && (Date.now() - new Date(latest.t).getTime()) <= 120000) }); });

app.post('/api/run-once', async (_, res) => {
  const state = loadState();
  const top = (state.scan_results || []).slice(0, Number(state.config.top_n || 10));
  if (!top.length) return res.status(400).json({ ok: false, message: 'no scan results' });
  state.signals = [];
  let tradesAdded = 0;
  for (const m of top) {
    const pMarket = Number(m.market_price || 0.5);
    const pModel = Math.max(0.01, Math.min(0.99, pMarket + (Math.random() - 0.5) * 0.2));
    const edge = pModel - pMarket;
    const direction = edge >= Number(state.config.min_edge || 0.04) ? 'BUY_YES' : edge <= -Number(state.config.min_edge || 0.04) ? 'BUY_NO' : 'NO_TRADE';
    state.signals.unshift({ time: new Date().toISOString(), market_id: m.id, title: m.question, marketPrice: pMarket, llmProb: pModel, edge, direction, risk_allowed: !state.config.kill_switch });
    if (direction !== 'NO_TRADE' && !state.config.kill_switch && state.config.paper_mode) {
      state.trades.unshift({ id: nextId(state.trades), time: new Date().toISOString(), market_id: m.id, title: m.question, direction, status: 'OPEN', positionUsd: Number((state.config.bankroll * 0.02).toFixed(2)), netPnlUsd: 0 });
      tradesAdded += 1;
    }
  }
  state.signals = state.signals.slice(0, 100);
  state.trades = state.trades.slice(0, 200);
  saveState(state);
  res.json({ ok: true, signals: state.signals.length, trades_added: tradesAdded });
});

// Auto-pipeline: runs full pipeline every scan interval (if auto_running enabled)
let pipelineTimer = null;
function ensurePipelineScheduler() {
  const state = loadState();
  const cfg = state.config || {};
  if (pipelineTimer) clearInterval(pipelineTimer);
  if (!cfg.auto_running) return;
  const everyMs = Math.max(15, Number(cfg.scan_interval_minutes || 15)) * 60 * 1000;
  console.log(`[pipeline] Auto-pipeline enabled, interval ${cfg.scan_interval_minutes || 15} min`);
  pipelineTimer = setInterval(async () => {
    const s = loadState();
    if (s.config?.kill_switch) { logLine(s, 'info', 'auto-pipeline skipped: kill switch active'); saveState(s); return; }
    try {
      logLine(s, 'info', 'auto-pipeline started'); saveState(s);
      await runSkillPipeline({ runScan: true, runResearch: true, runPredict: true, runExecute: true, runRisk: true });
      await runCompoundStep();
    } catch (e) {
      const s2 = loadState(); logLine(s2, 'error', `auto-pipeline failed: ${e.message}`); saveState(s2);
    }
  }, everyMs);
}

// --- Start ---
ensureScanScheduler();
ensurePipelineScheduler();
applyWebsocketConfig();
setInterval(flushWsTicksBuffer, 2000);
app.listen(port, () => console.log(`Backend listening on http://0.0.0.0:${port}`));

// Compound/Learning step: analyze results and write lessons
async function runCompoundStep() {
  const state = loadState();
  const trades = state.trades || [];
  const closedTrades = trades.filter(t => t.status !== 'OPEN' && t.netPnlUsd !== undefined);
  if (!closedTrades.length) return;

  // Calculate performance metrics
  const wins = closedTrades.filter(t => Number(t.netPnlUsd || 0) > 0).length;
  const losses = closedTrades.filter(t => Number(t.netPnlUsd || 0) < 0).length;
  const totalPnl = closedTrades.reduce((s, t) => s + Number(t.netPnlUsd || 0), 0);
  const winRate = closedTrades.length ? wins / closedTrades.length : 0;
  const grossProfit = closedTrades.filter(t => Number(t.netPnlUsd || 0) > 0).reduce((s, t) => s + Number(t.netPnlUsd || 0), 0);
  const grossLoss = Math.abs(closedTrades.filter(t => Number(t.netPnlUsd || 0) < 0).reduce((s, t) => s + Number(t.netPnlUsd || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

  state.compound_summary = {
    updated_at: new Date().toISOString(),
    total_trades: closedTrades.length,
    wins, losses, winRate: Number(winRate.toFixed(4)),
    totalPnl: Number(totalPnl.toFixed(2)),
    profitFactor: profitFactor === Infinity ? 'Infinity' : Number(profitFactor.toFixed(4)),
  };

  // Write losses to failure_log.md
  const recentLosses = closedTrades.filter(t => Number(t.netPnlUsd || 0) < 0).slice(0, 10);
  if (recentLosses.length) {
    try {
      const logDir = resolvePath(process.cwd(), 'predict-market-bot', 'references');
      mkdirSync(logDir, { recursive: true });
      const logPath = resolvePath(logDir, 'failure_log.md');
      const existing = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
      const newEntries = recentLosses.filter(t => !existing.includes(String(t.market_id || 'xxx')));
      if (newEntries.length) {
        const newText = newEntries.map(t => {
          const date = (t.time || new Date().toISOString()).slice(0, 10);
          const loss = Math.abs(Number(t.netPnlUsd || 0));
          const edge = Number(t.edge || 0);
          const conf = Number(t.confidence || 0);
          // Auto-classify the failure
          let rootCause = 'unknown';
          let lesson = '';
          if (Math.abs(edge) < 0.03) { rootCause = 'low_edge'; lesson = 'Edge war zu klein (<3%). Min Edge erhöhen oder Signal ignorieren.'; }
          else if (conf < 0.5) { rootCause = 'low_confidence'; lesson = 'Confidence war zu niedrig (<50%). Mehr Research-Quellen nötig.'; }
          else if (loss > Number(state.config?.bankroll||1000) * 0.04) { rootCause = 'oversized_position'; lesson = 'Position war zu groß. Kelly Fraction senken.'; }
          else { rootCause = 'bad_prediction'; lesson = 'Vorhersage war falsch trotz hoher Confidence. Prüfe ob die Nachrichtenquellen zuverlässig waren.'; }
          return `\n### ${date} — ${(t.title || t.market_id || 'unknown').slice(0, 60)}\n- **Result:** Loss $${loss.toFixed(2)}\n- **Direction:** ${t.direction || '?'} | Edge: ${(edge*100).toFixed(1)}% | Conf: ${(conf*100).toFixed(0)}%\n- **Root cause:** ${rootCause}\n- **Lesson:** ${lesson}\n`;
        }).join('');
        appendFileSync(logPath, newText, 'utf8');
        logLine(state, 'info', `compound: ${newEntries.length} losses logged to failure_log.md (auto-classified)`);
      }
    } catch (e) { logLine(state, 'warning', `compound: failed to write failure_log: ${e.message}`); }
  }

  // Calculate Sharpe Ratio (annualized, simplified)
  if (closedTrades.length >= 5) {
    const returns = closedTrades.map(t => Number(t.netPnlUsd || 0) / Math.max(1, Number(t.positionUsd || 1)));
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length);
    state.compound_summary.sharpe_ratio = stdReturn > 0 ? Number((avgReturn / stdReturn * Math.sqrt(252)).toFixed(3)) : 0;
  }

  // Recalculate Brier Score
  recalcBrierScore(state);
  state.compound_summary.brier_score = state.brier_score;
  state.compound_summary.brier_samples = state.brier_samples;

  logLine(state, 'info', `compound: ${closedTrades.length} trades, WR=${(winRate*100).toFixed(0)}%, PF=${state.compound_summary.profitFactor}, Brier=${state.brier_score??'n/a'}`);
  saveState(state);
}

app.post('/api/compound/run', async (_, res) => {
  try { await runCompoundStep(); res.json({ ok: true, summary: loadState().compound_summary }); }
  catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});
app.get('/api/compound/status', (_, res) => res.json({ ok: true, summary: loadState().compound_summary || {} }));

// ═══════════════════════════════════════════
// BRIER SCORE — automatisch berechnen
// ═══════════════════════════════════════════
// Was ist der Brier Score?
// Er misst wie gut deine Vorhersagen sind.
// Formel: BS = (1/n) × Σ(vorhergesagt - tatsächlich)²
// Beispiel: Du sagst 70% Wahrscheinlichkeit, Event tritt ein → (0.7 - 1)² = 0.09
// Beispiel: Du sagst 70%, Event tritt NICHT ein → (0.7 - 0)² = 0.49
// Perfekt = 0.0, Münzwurf = 0.25, Schlecht > 0.25
// Ziel: unter 0.25 bleiben!

function recalcBrierScore(state) {
  const outcomes = state.prediction_outcomes || [];
  if (!outcomes.length) { state.brier_score = null; return; }
  const ready = outcomes.filter(x => Number.isFinite(Number(x.predicted_prob)) && (x.outcome === 0 || x.outcome === 1));
  if (!ready.length) { state.brier_score = null; return; }
  const score = ready.reduce((sum, x) => sum + ((Number(x.predicted_prob) - Number(x.outcome)) ** 2), 0) / ready.length;
  state.brier_score = Number(score.toFixed(5));
  state.brier_samples = ready.length;
}

// Auto-recalc Brier when outcomes are recorded
const origRecordOutcomes = recordPredictionOutcomes;
// Override the predict outcomes endpoint to auto-calc Brier
app.post('/api/predict/outcomes', (req, res) => {
  const s = loadState();
  origRecordOutcomes(s, req.body?.items || []);
  recalcBrierScore(s);
  saveState(s);
  const cal = computeBrierCalibration(s.prediction_outcomes || []);
  res.json({ ok: true, brier_score: s.brier_score, brier_samples: s.brier_samples, calibration: cal });
});

// ═══════════════════════════════════════════
// NIGHTLY REVIEW — einmal täglich um Mitternacht UTC
// ═══════════════════════════════════════════
// Was macht der Nightly Review?
// 1. Analysiert ALLE Trades des Tages
// 2. Berechnet Tages-Performance (Win Rate, P&L, Profit Factor)
// 3. Aktualisiert den Brier Score
// 4. Loggt eine Zusammenfassung
// 5. Setzt den täglichen Verlust-Zähler zurück

let lastNightlyDate = '';
function checkNightlyReview() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === lastNightlyDate) return; // schon gelaufen heute
  const hour = new Date().getUTCHours();
  if (hour !== 0) return; // nur um Mitternacht UTC

  lastNightlyDate = today;
  const state = loadState();
  const trades = state.trades || [];
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayTrades = trades.filter(t => (t.time || '').startsWith(yesterday));

  const wins = todayTrades.filter(t => Number(t.netPnlUsd || 0) > 0).length;
  const losses = todayTrades.filter(t => Number(t.netPnlUsd || 0) < 0).length;
  const pnl = todayTrades.reduce((s, t) => s + Number(t.netPnlUsd || 0), 0);

  // Recalc Brier Score
  recalcBrierScore(state);

  // Reset daily loss counter
  if (state.risk) state.risk.daily_realized_pnl = 0;

  // Log the review
  state.nightly_reviews = state.nightly_reviews || [];
  state.nightly_reviews.unshift({
    date: yesterday,
    trades: todayTrades.length,
    wins, losses,
    pnl: Number(pnl.toFixed(2)),
    brier_score: state.brier_score,
    brier_samples: state.brier_samples,
  });
  state.nightly_reviews = state.nightly_reviews.slice(0, 90); // 90 Tage behalten

  logLine(state, 'info', `nightly review (${yesterday}): ${todayTrades.length} trades, ${wins}W/${losses}L, P&L=$${pnl.toFixed(2)}, Brier=${state.brier_score ?? 'n/a'}`);
  saveState(state);
}

// Check every hour
setInterval(checkNightlyReview, 60 * 60 * 1000);
// Also check on startup
setTimeout(checkNightlyReview, 5000);

app.get('/api/nightly/status', (_, res) => {
  const s = loadState();
  res.json({ ok: true, reviews: (s.nightly_reviews || []).slice(0, 30), brier_score: s.brier_score, brier_samples: s.brier_samples });
});
