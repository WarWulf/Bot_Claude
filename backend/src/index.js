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

import { loadState, saveState, logLine, buildScannerHealth, maskProviderKeys, nextId, defaultState } from './appState.js';
import { loadSkillProfiles } from './stepRegistry.js';
import { liveCommLog } from './utils.js';
import { computeBrierCalibration } from './utils.js';
import { registerAuthRoutes } from './auth.js';
import { buildPolymarketAuthHeaders, buildKalshiAuthHeaders, runPolymarketConnectionTest, runKalshiConnectionTest } from './platforms.js';
import { websocketState, flushWsTicksBuffer, applyWebsocketConfig, stopWebsocket } from './websockets.js';
import { scannerRuntime, scanAudit, runScanCycle, onScanFailure, ensureScanScheduler, scanAndRankMarkets } from './scanner.js';
import { runResearchStep } from './research.js';
import { runPredictStep, recordPredictionOutcomes } from './predict.js';
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
  try { const { ranked, added, source, state } = await runScanCycle({ force: true }); res.json({ ok: true, source, added, tradeable_count: ranked.length, top: ranked.slice(0, 20), scanner_health: buildScannerHealth(state.markets || [], state.config || {}) }); }
  catch (e) { const s = loadState(); onScanFailure(e, s.config || {}); scanAudit(s, 'scan_failed_manual', { error: e.message }); saveState(s); res.status(500).json({ ok: false, message: e.message }); }
});
app.get('/api/scan/status', (_, res) => { const now = Date.now(); res.json({ runtime: { ...scannerRuntime, breaker_open: scannerRuntime.breakerUntil > now, breaker_remaining_sec: scannerRuntime.breakerUntil > now ? Math.ceil((scannerRuntime.breakerUntil - now) / 1000) : 0 }, last_run: (loadState().scan_runs || [])[0] || null }); });
app.get('/api/scan/self-test', (_, res) => res.json(runStep1SelfTest(loadState())));
app.get('/api/scan/live-log', (_, res) => { const latest = liveCommLog[0] || null; res.json({ ok: true, total: liveCommLog.length, connected: Boolean(latest && (Date.now() - new Date(latest.t).getTime()) <= 120000), items: liveCommLog.slice(0, 200) }); });

// --- Research ---
app.post('/api/research/run', async (_, res) => { try { res.json({ ok: true, ...await runResearchStep() }); } catch (e) { res.status(500).json({ ok: false, message: e.message }); } });
app.get('/api/research/status', (_, res) => { const s = loadState(); res.json({ summary: s.research_summary || {}, briefs: (s.research_briefs || []).slice(0, 20) }); });
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
app.post('/api/predict/outcomes', (req, res) => { const s = loadState(); const outcomes = recordPredictionOutcomes(s, req.body?.items || []); res.json({ ok: true, calibration: computeBrierCalibration(outcomes) }); });
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
  applyWebsocketConfig();
  res.json({ ok: true });
});

app.post('/api/kill-switch', (req, res) => { const s = loadState(); s.config.kill_switch = Boolean(req.body?.enabled); logLine(s, s.config.kill_switch ? 'warning' : 'info', `kill switch ${s.config.kill_switch ? 'enabled' : 'disabled'}`); saveState(s); res.json({ ok: true, kill_switch: s.config.kill_switch }); });

app.post('/api/step1/finalize', async (_, res) => {
  try { const s = loadState(); s.config = { ...s.config, ...sanitizeConfigPatch(buildStep1ProductionPreset(), s.config || {}) }; saveState(s); const out = await runScanCycle({ force: true }); res.json({ ok: true, tradeable_count: out?.ranked?.length || 0, step1_progress_pct: computeStepStatus(loadState()).step1?.progress_pct || 0 }); }
  catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

app.post('/api/markets/reset', (req, res) => { const s = loadState(); const prev = s.markets.length; s.markets = []; s.scan_results = []; s.scan_runs = []; s.scan_history = {}; s.research_briefs = []; logLine(s, 'warning', 'markets reset'); saveState(s); res.json({ ok: true, previous_markets: prev }); });

// --- Connections ---
app.get('/api/connection/test', async (_, res) => { const cfg = loadState().config || {}; const pm = await runPolymarketConnectionTest(cfg); const ka = await runKalshiConnectionTest(cfg); res.status(pm.reachable || ka.reachable ? 200 : 503).json({ ok: pm.reachable || ka.reachable, polymarket: pm, kalshi: ka }); });
app.get('/api/connection/test/polymarket', async (_, res) => { const r = await runPolymarketConnectionTest(loadState().config || {}); res.status(r.reachable ? 200 : 503).json({ ok: r.reachable, ...r }); });
app.get('/api/connection/test/kalshi', async (_, res) => { const r = await runKalshiConnectionTest(loadState().config || {}); res.status(r.reachable ? 200 : 503).json({ ok: r.reachable, ...r }); });

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

// --- Start ---
ensureScanScheduler();
applyWebsocketConfig();
setInterval(flushWsTicksBuffer, 2000);
app.listen(port, () => console.log(`Backend listening on http://0.0.0.0:${port}`));
