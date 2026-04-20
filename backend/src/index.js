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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { loadState, saveState, logLine, buildScannerHealth, maskProviderKeys, nextId, defaultState } from './appState.js';
import { loadSkillProfiles } from './stepRegistry.js';
import { liveCommLog, pushLiveComm, fetchWithRetry } from './utils.js';
import { computeBrierCalibration } from './utils.js';
import { registerAuthRoutes } from './auth.js';
import { scanForexSignals, FOREX_PAIRS, openForexPaperTrade, resolveForexTrades, getForexStats, fetchCandleData, analyzeForexLearning, getForexLlmOpinion, generateForexRecommendations, runForexAutoTrade, openForexProTrade, resolveForexProTrades, closeForexProTrade, getForexProStats, generateForexProRecommendations, fetchForexNews, buildForexNewsContext, persistForexNews, createManualTradePlan, reportManualTradeResult, runBacktest } from './forexSignals.js';
import { runLearningCycle, analyzePredictionAccuracy, analyzeForexSignalAccuracy, buildFullLearningContext, updateSourceCredibility, discoverKeywordsAndSources, analyzeNewsImpact } from './learningEngine.js';

// Auto-resolve forex trades + learning cycle every 10 seconds
setInterval(async () => {
  try {
    const s = loadState();
    let changed = false;
    const openBinary = (s.forex_trades || []).filter(t => t.status === 'OPEN').length;
    if (openBinary > 0) { const r = await resolveForexTrades(s); if (r > 0) changed = true; }
    const openPro = (s.forex_pro_trades || []).filter(t => t.status === 'OPEN').length;
    if (openPro > 0) { const r = await resolveForexProTrades(s); if (r > 0) changed = true; }
    if (changed) saveState(s);
  } catch {}
}, 10000);

// Learning cycle every 2 minutes — observe outcomes, rank sources, track forex signals
setInterval(async () => {
  try {
    const s = loadState();
    const results = await runLearningCycle(s);
    if (results.observations > 0 || results.forex_resolved > 0) saveState(s);
  } catch {}
}, 120000);

// Forex auto-trading timer
let forexAutoTimer = null;
function ensureForexAutoTrader() {
  const cfg = loadState().config || {};
  const enabled = cfg.forex_auto_enabled;
  const intervalMin = Math.max(1, Number(cfg.forex_auto_interval_min || 5));

  if (forexAutoTimer) { clearInterval(forexAutoTimer); forexAutoTimer = null; }
  if (!enabled) return;

  forexAutoTimer = setInterval(async () => {
    try {
      const s = loadState();
      if (!s.config?.forex_auto_enabled) return;
      const result = await runForexAutoTrade(s);
      if (result.executed > 0) {
        logLine(s, 'info', `forex auto: ${result.trade.direction} ${result.trade.symbol} $${result.recommendation.recommended_amount} für ${result.recommendation.recommended_duration}min (score: ${result.recommendation.score})`);
      }
      saveState(s);
    } catch (e) { console.error('forex auto error:', e.message); }
  }, intervalMin * 60 * 1000);
  console.log(`[forex] Auto-trader enabled: every ${intervalMin}min`);
}
ensureForexAutoTrader();
import { buildPolymarketAuthHeaders, buildKalshiAuthHeaders, runPolymarketConnectionTest, runKalshiConnectionTest, fetchPolymarketMarkets, fetchKalshiMarkets } from './platforms.js';
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

// ═══ RATE LIMITING — opt-in, simple in-memory ═══
const rateLimitBuckets = new Map();
function rateLimitMiddleware(req, res, next) {
  const cfg = loadState().config || {};
  if (!cfg.rate_limit_enabled) return next();
  const maxPerMin = Number(cfg.rate_limit_per_minute || 60);
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const bucket = rateLimitBuckets.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + windowMs; }
  bucket.count++;
  rateLimitBuckets.set(ip, bucket);
  res.setHeader('X-RateLimit-Limit', maxPerMin);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, maxPerMin - bucket.count));
  if (bucket.count > maxPerMin) {
    return res.status(429).json({ ok: false, error: `Rate limit: max ${maxPerMin} Anfragen pro Minute. Reset in ${Math.ceil((bucket.resetAt - now) / 1000)}s.` });
  }
  next();
}

// Cleanup old buckets every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets.entries()) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(ip);
  }
}, 5 * 60 * 1000);

app.use(rateLimitMiddleware);
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

// Health check — for external monitoring (UptimeRobot, Grafana, etc.)
app.get('/health', (_, res) => {
  try {
    const s = loadState();
    const openBinary = (s.forex_trades || []).filter(t => t.status === 'OPEN').length;
    const openPro = (s.forex_pro_trades || []).filter(t => t.status === 'OPEN').length;
    const openPm = (s.trades || []).filter(t => t.status === 'OPEN' || t.status === 'FILLED').length;
    const todayKey = new Date().toISOString().slice(0, 10);
    const quota = s.api_quota?.twelvedata?.date === todayKey ? s.api_quota.twelvedata.count : 0;
    const lastLlm = (s.llm_prompt_log || [])[0];
    const lastLlmAge = lastLlm ? Math.floor((Date.now() - new Date(lastLlm.time).getTime()) / 1000) : null;
    res.json({
      status: 'ok',
      uptime_sec: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      bankroll: { pm: s.bankroll || 0, forex: s.forex_bankroll || 0, forex_pro: s.forex_pro_bankroll || 0 },
      open_trades: { pm: openPm, forex_binary: openBinary, forex_pro: openPro },
      total_trades: {
        pm: (s.trades || []).length,
        forex_binary: (s.forex_trades || []).length,
        forex_pro: (s.forex_pro_trades || []).length,
      },
      api_quota: { twelvedata: { used: quota, limit: 800, pct: Math.round(quota / 800 * 100) } },
      last_llm_request_sec_ago: lastLlmAge,
      last_llm_success: lastLlm?.success ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// API Quota status endpoint
app.get('/api/quota', (_, res) => {
  const s = loadState();
  const todayKey = new Date().toISOString().slice(0, 10);
  const q = s.api_quota || {};
  const result = {};
  for (const [provider, data] of Object.entries(q)) {
    if (data.date !== todayKey) { result[provider] = { used: 0, date: todayKey }; continue; }
    const limit = provider === 'twelvedata' ? 800 : provider === 'alphavantage' ? 500 : 1000;
    result[provider] = { used: data.count, limit, pct: Math.round(data.count / limit * 100), date: data.date, warning: data.count >= limit * 0.8, exhausted: data.count >= limit };
  }
  res.json(result);
});

// --- Scan ---
app.get('/api/scan', (_, res) => { const s = loadState(); res.json({ scannedAt: s.scan_runs?.[0]?.time || null, markets: s.scan_results || [], runs: s.scan_runs || [] }); });
app.get('/api/scan/all-markets', (_, res) => {
  const s = loadState();
  const markets = (s.markets || []).map(m => ({
    ...m,
    expired: m.end_date ? new Date(m.end_date).getTime() < Date.now() : false,
    in_top: (s.scan_results || []).some(r => r.market === m.market),
  })).sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0));
  res.json({ ok: true, total: markets.length, markets });
});

// Diagnostic: test what APIs return raw
app.get('/api/scan/diagnose', async (_, res) => {
  const state = loadState();
  const cfg = state.config || {};
  const diag = { polymarket: { raw: 0, error: null }, kalshi: { raw: 0, error: null }, filters: {}, scanner: {} };
  let pmMarkets = [], kaMarkets = [];
  try { pmMarkets = await fetchPolymarketMarkets(200); diag.polymarket.raw = pmMarkets.length; diag.polymarket.sample = pmMarkets.slice(0, 3).map(m => ({ q: m.question?.slice(0, 60), price: m.market_price, vol: m.volume, liq: m.liquidity, days: m.days_to_expiry, cat: m.category })); } catch (e) { diag.polymarket.error = String(e.message).slice(0, 150); }
  try { kaMarkets = await fetchKalshiMarkets(200); diag.kalshi.raw = kaMarkets.length; diag.kalshi.sample = kaMarkets.slice(0, 3).map(m => ({ q: m.question?.slice(0, 60), price: m.market_price, vol: m.volume, liq: m.liquidity, days: m.days_to_expiry, cat: m.category })); } catch (e) { diag.kalshi.error = String(e.message).slice(0, 150); }
  diag.filters = { min_volume: cfg.scanner_min_volume ?? '(default 200)', min_liquidity: cfg.scanner_min_liquidity ?? '(default 0)', max_days: cfg.scanner_max_days ?? '(default 90)', categories: cfg.scanner_market_categories || '(alle — kein Filter)', min_price: cfg.min_market_price ?? 0.05, max_price: cfg.max_market_price ?? 0.95, max_slippage: cfg.scanner_max_slippage_pct ?? 0.10 };
  const allMarkets = [...pmMarkets, ...kaMarkets];
  const ranked = scanAndRankMarkets(allMarkets, cfg);
  diag.scanner = { total_fetched: allMarkets.length, after_ranking: ranked.length, filter_stats: scannerRuntime.lastFilterStats || {}, markets_in_db: (state.markets || []).length };
  if (ranked.length === 0 && allMarkets.length > 0) {
    const reasons = [];
    const sample = allMarkets[0];
    if (Number(sample?.volume || 0) < Number(cfg.scanner_min_volume || 200)) reasons.push(`Volume ${sample?.volume} < min_volume ${cfg.scanner_min_volume || 200}. LÖSUNG: Setze Min Volume auf 200.`);
    if (Number(cfg.scanner_min_liquidity || 0) > 0 && Number(sample?.liquidity || 0) < Number(cfg.scanner_min_liquidity)) reasons.push(`Liquidity ${sample?.liquidity} < min_liquidity ${cfg.scanner_min_liquidity}. LÖSUNG: Setze Min Liquidität auf 0.`);
    if (cfg.scanner_market_categories) reasons.push(`Category filter "${cfg.scanner_market_categories}" aktiv — vielleicht filtert er alles raus. LÖSUNG: Feld leeren.`);
    diag.scanner.filter_reasons = reasons;
    diag.scanner.first_market = { q: sample?.question?.slice(0, 80), vol: sample?.volume, liq: sample?.liquidity, days: sample?.days_to_expiry, cat: sample?.category, price: sample?.market_price };
  }
  diag.recommendation = ranked.length > 0 ? 'Scan funktioniert.' : allMarkets.length > 0 ? `APIs liefern ${allMarkets.length} Märkte aber alle werden rausgefiltert. Prüfe Scanner-Einstellungen!` : 'APIs liefern 0 Märkte. Prüfe Netzwerk-Verbindung (docker logs).';
  res.json(diag);
});

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
app.get('/api/news/digest', (_, res) => { const s = loadState(); res.json(s.news_digest || { items: [] }); });
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
app.post('/api/trades/reset', (req, res) => { const s = loadState(); const prev = (s.trades||[]).length; s.trades = []; s.signals = []; s.orders = []; s.execution_runs = []; s.risk = { peak_bankroll: Number(s.config?.bankroll||1000), drawdown_pct: 0, daily_realized_pnl: 0, open_exposure_usd: 0, open_positions: 0, level: 'OK' }; s.step4_summary = { completed_at: null, candidate_signals:0, executed_orders:0, skipped_orders:0, opened_trades:0, risk_blocked_orders:0, paper_mode: true }; s.compound_summary = null; s.risk_runs = []; logLine(s, 'warning', `trades reset (${prev} deleted, risk+drawdown reset)`); saveState(s); res.json({ ok: true, previous_trades: prev }); });

// ═══ FOREX SIGNALS ═══
app.get('/api/forex/pairs', (_, res) => res.json({ pairs: FOREX_PAIRS }));
app.post('/api/forex/scan', async (req, res) => {
  try {
    const interval = req.body?.interval || '5min';
    const pairs = req.body?.pairs || null;
    const result = await scanForexSignals(pairs, interval);
    // Store signals
    const s = loadState();
    s.forex_signals = result;
    s.forex_runs = s.forex_runs || [];
    s.forex_runs.unshift({ time: result.time, interval, pairs_scanned: result.signals.length, signals_found: result.signals.filter(s => s.direction !== 'WAIT').length });
    s.forex_runs = s.forex_runs.slice(0, 100);
    saveState(s);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/forex/signals', (_, res) => { const s = loadState(); res.json(s.forex_signals || { signals: [] }); });

// Forex Diagnose — test API connectivity
app.get('/api/forex/diagnose', async (_, res) => {
  const s = loadState();
  const cfg = s.config || {};
  const apiKey = String(cfg.forex_api_key || '').trim();
  const provider = String(cfg.forex_data_provider || 'twelvedata');
  const diag = {
    api_key_set: !!apiKey,
    api_key_preview: apiKey ? apiKey.slice(0, 4) + '***' + apiKey.slice(-3) : '(leer)',
    provider,
    test_symbol: 'EUR/USD',
    result: null,
    error: null,
    raw_response: null,
  };

  if (!apiKey) {
    diag.error = `Kein API-Key! Gehe zu Einstellungen → Forex → API Key eintragen. Kostenlos bei ${provider === 'twelvedata' ? 'twelvedata.com' : 'alphavantage.co'}`;
    return res.json(diag);
  }

  try {
    if (provider === 'twelvedata') {
      const url = `https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=5min&outputsize=3&apikey=${apiKey}`;
      const resp = await fetchWithRetry(url, {}, { label: 'forex-diagnose', retries: 1, timeoutMs: 12000, silent: true });
      const data = await resp.json();
      diag.raw_response = { status: data.status, meta: data.meta, values_count: (data.values || []).length, message: data.message };
      if (data.status === 'error') {
        diag.error = `TwelveData Fehler: ${data.message || 'unbekannt'}`;
        if (String(data.message || '').includes('apikey')) diag.error += ' → API-Key ungültig!';
        if (String(data.message || '').includes('symbol')) diag.error += ' → Symbol nicht gefunden!';
      } else if ((data.values || []).length > 0) {
        diag.result = 'OK';
        diag.sample_price = data.values[0]?.close;
        diag.sample_time = data.values[0]?.datetime;
      } else {
        diag.error = 'Keine Daten zurückgegeben. Markt geschlossen?';
      }
    } else if (provider === 'alphavantage') {
      const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=EUR&to_symbol=USD&interval=5min&outputsize=compact&apikey=${apiKey}`;
      const resp = await fetchWithRetry(url, {}, { label: 'forex-diagnose', retries: 1, timeoutMs: 12000, silent: true });
      const data = await resp.json();
      const tsKey = Object.keys(data).find(k => k.includes('Time Series'));
      diag.raw_response = { keys: Object.keys(data), has_time_series: !!tsKey, note: data['Note'], error: data['Error Message'] };
      if (data['Error Message']) diag.error = `AlphaVantage: ${data['Error Message']}`;
      else if (data['Note']) diag.error = 'AlphaVantage: Rate Limit. Warte 1 Minute.';
      else if (tsKey) { diag.result = 'OK'; diag.sample_entries = Object.keys(data[tsKey]).length; }
      else diag.error = 'Keine Daten. API-Key korrekt?';
    }
  } catch (e) {
    diag.error = `Verbindungsfehler: ${e.message}. VPS kann ${provider} nicht erreichen?`;
  }

  diag.recommendation = diag.result === 'OK'
    ? '✅ API funktioniert! Du kannst Forex scannen.'
    : diag.error || '❌ Unbekannter Fehler';

  res.json(diag);
});

// Forex Paper Trading
app.post('/api/forex/trade', async (req, res) => {
  try {
    const { symbol, direction, duration_min, amount, signal_data } = req.body || {};
    if (!symbol || !direction || !duration_min || !amount) return res.status(400).json({ ok: false, error: 'symbol, direction, duration_min, amount required' });
    const s = loadState();
    const candles = await fetchCandleData(symbol, '1min', 3);
    const entryPrice = candles[candles.length - 1]?.close;
    if (!entryPrice) return res.status(500).json({ ok: false, error: 'Could not fetch entry price' });
    const result = openForexPaperTrade(s, { symbol, direction, duration_min, amount, signal_data });
    if (!result.ok) return res.status(400).json(result);
    result.trade.entry_price = entryPrice;
    saveState(s);
    res.json({ ok: true, trade: result.trade, bankroll: s.forex_bankroll });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/forex/stats', async (_, res) => {
  const s = loadState();
  const resolved = await resolveForexTrades(s).catch(() => 0);
  if (resolved > 0) saveState(s);
  res.json(getForexStats(s));
});

app.get('/api/forex/trades', (_, res) => {
  const s = loadState();
  res.json({ trades: (s.forex_trades || []).slice(0, 100), bankroll: s.forex_bankroll ?? Number(s.config?.forex_bankroll || 100) });
});

// Learning & LLM
app.get('/api/forex/learning', (_, res) => {
  const s = loadState();
  res.json(analyzeForexLearning(s));
});

// ═══ LEARNING & INTELLIGENCE ═══
app.get('/api/learning/status', (_, res) => {
  const s = loadState();
  const discoveries = discoverKeywordsAndSources(s);
  res.json({
    pm_accuracy: analyzePredictionAccuracy(s),
    forex_signal_accuracy: analyzeForexSignalAccuracy(s),
    news_impact: analyzeNewsImpact(s),
    source_ranking: s.source_ranking || [],
    source_scores: s.source_scores || {},
    signal_log_count: (s.forex_signal_log || []).length,
    news_history_count: (s.forex_news_history || []).length,
    news_trade_log_count: (s.forex_news_trade_log || []).length,
    discoveries,
  });
});

app.post('/api/learning/run', async (_, res) => {
  try {
    const s = loadState();
    const results = await runLearningCycle(s);
    const discoveries = discoverKeywordsAndSources(s);
    saveState(s);
    res.json({ ok: true, ...results, pm_accuracy: analyzePredictionAccuracy(s), forex_accuracy: analyzeForexSignalAccuracy(s), discoveries });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/forex/llm-opinion', async (req, res) => {
  try {
    const { signal } = req.body || {};
    if (!signal) return res.status(400).json({ ok: false, error: 'signal required' });
    const s = loadState();
    let newsCtx = '';
    try {
      const news = await fetchForexNews(s.config || {}, { fetchBodies: true, state: s });
      s.forex_news = news;
      persistForexNews(s, news);
      newsCtx = buildForexNewsContext(news, signal.symbol);
    } catch (e) { pushLiveComm('forex_news_fetch_error', { where: 'llm-opinion', error: e.message }); }
    const result = await getForexLlmOpinion(signal, s, newsCtx);
    saveState(s);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/forex/news', async (_, res) => {
  try {
    const s = loadState();
    // Bot decides automatically whether to fetch bodies (HIGH IMPACT detection)
    const news = await fetchForexNews(s.config || {}, { state: s });
    s.forex_news = news;
    persistForexNews(s, news);
    saveState(s);
    res.json({ ok: true, ...news, history_count: (s.forex_news_history || []).length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/forex/news/history', (_, res) => {
  const s = loadState();
  res.json({
    total: (s.forex_news_history || []).length,
    items: (s.forex_news_history || []).slice(0, 100),
  });
});

// LLM Prompt Log — see exactly what was sent to each LLM
app.get('/api/llm/prompts', (req, res) => {
  const s = loadState();
  const limit = Math.min(50, Number(req.query?.limit || 20));
  res.json({
    total: (s.llm_prompt_log || []).length,
    items: (s.llm_prompt_log || []).slice(0, limit),
  });
});

app.get('/api/llm/prompts/:index', (req, res) => {
  const s = loadState();
  const idx = Number(req.params.index);
  const entry = (s.llm_prompt_log || [])[idx];
  if (!entry) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json(entry);
});

app.post('/api/forex/reset', (_, res) => {
  const s = loadState();
  const prev = (s.forex_trades || []).length;
  s.forex_trades = [];
  s.forex_bankroll = Number(s.config?.forex_bankroll || 100);
  saveState(s);
  res.json({ ok: true, previous_trades: prev, bankroll: s.forex_bankroll });
});

// ═══ MANUAL TRADE MODE — Bot plans trade, user executes externally, reports back ═══
app.post('/api/forex/manual/plan', async (req, res) => {
  try {
    const { symbol, direction, signal_data } = req.body || {};
    if (!symbol || !direction) return res.status(400).json({ ok: false, error: 'symbol + direction required' });
    const s = loadState();
    // Fetch FRESH price to avoid stale signal (fix #21)
    let freshPrice = null;
    try {
      const candles = await fetchCandleData(symbol, '1min', 2);
      freshPrice = candles[candles.length - 1]?.close || null;
    } catch (e) { pushLiveComm('price_fetch_error', { symbol, error: e.message }); }
    const plan = createManualTradePlan(s, { symbol, direction, signal_data, current_price_fresh: freshPrice });
    saveState(s);
    res.json({ ok: true, plan });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/forex/manual/result', (req, res) => {
  try {
    const { plan_id, amount, duration_min, result, entry_price, exit_price, entry_time, payout_pct } = req.body || {};
    if (!plan_id || !result) return res.status(400).json({ ok: false, error: 'plan_id + result required' });
    if (!['WIN', 'LOSS', 'DRAW'].includes(result)) return res.status(400).json({ ok: false, error: 'result must be WIN/LOSS/DRAW' });
    const s = loadState();
    const out = reportManualTradeResult(s, plan_id, { amount, duration_min, result, entry_price, exit_price, entry_time, payout_pct });
    if (!out.ok) return res.status(400).json(out);
    saveState(s);
    res.json(out);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/forex/manual/plans', (_, res) => {
  const s = loadState();
  res.json({ plans: (s.manual_trade_plans || []).slice(0, 50) });
});

app.post('/api/forex/manual/cancel', (req, res) => {
  const { plan_id } = req.body || {};
  const s = loadState();
  const plan = (s.manual_trade_plans || []).find(p => p.id === plan_id);
  if (!plan) return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
  plan.status = 'CANCELLED';
  plan.cancelled_at = new Date().toISOString();
  saveState(s);
  res.json({ ok: true, plan });
});

// Backtest — replay strategy on historical candles
app.post('/api/forex/backtest', async (req, res) => {
  try {
    const { symbol, interval, candles_count, duration_min } = req.body || {};
    if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });
    const s = loadState();
    const result = await runBacktest(s, {
      symbol,
      interval: interval || '5min',
      candles_count: Math.min(500, Number(candles_count || 200)),
      duration_min: Number(duration_min || 3),
    });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Recommendations — smart signals with position sizing + learning + news
app.post('/api/forex/recommendations', async (req, res) => {
  try {
    const s = loadState();
    const interval = req.body?.interval || s.config?.forex_interval || '5min';
    const scanResult = await scanForexSignals(null, interval);
    s.forex_signals = scanResult;
    // Fetch news for context
    try { s.forex_news = await fetchForexNews(s.config || {}, { state: s }); persistForexNews(s, s.forex_news); } catch (e) { pushLiveComm('forex_news_fetch_error', { where: 'recommendations', error: e.message }); }
    const recs = generateForexRecommendations(scanResult.signals, s);
    saveState(s);
    res.json({ ok: true, ...recs, news_available: !!(s.forex_news?.forex_relevant) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Auto-trade toggle
app.post('/api/forex/auto', (req, res) => {
  const s = loadState();
  s.config = s.config || {};
  if (req.body?.enabled !== undefined) s.config.forex_auto_enabled = Boolean(req.body.enabled);
  if (req.body?.interval_min) s.config.forex_auto_interval_min = Number(req.body.interval_min);
  if (req.body?.min_score) s.config.forex_auto_min_score = Number(req.body.min_score);
  saveState(s);
  ensureForexAutoTrader();
  res.json({ ok: true, auto_enabled: s.config.forex_auto_enabled, interval_min: s.config.forex_auto_interval_min || 5 });
});

// ═══ FOREX PRO (Stop-Loss / Take-Profit) ═══
app.post('/api/forex-pro/trade', async (req, res) => {
  try {
    const { symbol, direction, sl_pips, tp_pips, risk_pct, signal_data } = req.body || {};
    if (!symbol || !direction) return res.status(400).json({ ok: false, error: 'symbol + direction required' });
    const s = loadState();
    const candles = await fetchCandleData(symbol, '1min', 3);
    const entryPrice = candles[candles.length - 1]?.close;
    if (!entryPrice) return res.status(500).json({ ok: false, error: 'Kein Einstiegspreis verfügbar' });
    const result = openForexProTrade(s, { symbol, direction, sl_pips, tp_pips, risk_pct, entry_price: entryPrice, signal_data });
    if (!result.ok) return res.status(400).json(result);
    saveState(s);
    res.json({ ok: true, trade: result.trade, bankroll: s.forex_pro_bankroll });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/forex-pro/close', (req, res) => {
  const { trade_id } = req.body || {};
  if (!trade_id) return res.status(400).json({ ok: false, error: 'trade_id required' });
  const s = loadState();
  const result = closeForexProTrade(s, trade_id);
  if (!result.ok) return res.status(400).json(result);
  saveState(s);
  res.json({ ok: true, trade: result.trade, bankroll: s.forex_pro_bankroll });
});

app.get('/api/forex-pro/stats', async (_, res) => {
  const s = loadState();
  await resolveForexProTrades(s).catch(() => 0);
  saveState(s);
  res.json(getForexProStats(s));
});

app.post('/api/forex-pro/recommendations', async (req, res) => {
  try {
    const s = loadState();
    const interval = req.body?.interval || s.config?.forex_interval || '15min';
    const scanResult = await scanForexSignals(null, interval);
    s.forex_signals = scanResult;
    const recs = generateForexProRecommendations(scanResult.signals, s);
    saveState(s);
    res.json({ ok: true, ...recs });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/forex-pro/reset', (_, res) => {
  const s = loadState();
  s.forex_pro_trades = [];
  s.forex_pro_bankroll = Number(s.config?.forex_pro_bankroll || 1000);
  saveState(s);
  res.json({ ok: true, bankroll: s.forex_pro_bankroll });
});

// Export bot performance data for external analysis
app.get('/api/export/performance', (_, res) => {
  const s = loadState();
  const exportData = {
    exported_at: new Date().toISOString(),
    strategy_version: s.config?.strategy_version || 1,
    bot_runtime_days: s.scan_runs?.length ? Math.ceil((Date.now() - new Date(s.scan_runs[s.scan_runs.length-1].time).getTime()) / 86400000) : 0,
    // Core metrics
    bankroll: { starting: s.config?.starting_bankroll || 1000, current: (s.config?.bankroll || 0) + (s.trades || []).filter(t=>t.status!=='OPEN').reduce((sum,t)=>sum+Number(t.netPnlUsd||0),0), configured: s.config?.bankroll || 0 },
    performance: {
      total_trades: (s.trades || []).length,
      open_trades: (s.trades || []).filter(t => t.status === 'OPEN').length,
      closed_trades: (s.trades || []).filter(t => t.status !== 'OPEN').length,
      winning_trades: (s.trades || []).filter(t => Number(t.netPnlUsd || 0) > 0).length,
      losing_trades: (s.trades || []).filter(t => Number(t.netPnlUsd || 0) < 0).length,
      total_pnl: (s.trades || []).reduce((sum, t) => sum + Number(t.netPnlUsd || 0), 0),
      win_rate: s.compound_summary?.win_rate_pct,
      profit_factor: s.compound_summary?.profitFactor,
      sharpe_ratio: s.compound_summary?.sharpe_ratio,
      brier_score: s.brier_score,
      brier_samples: s.brier_samples,
      max_drawdown_pct: s.risk?.drawdown_pct,
    },
    // All trades with full context for analysis
    trades: (s.trades || []).map(t => ({
      id: t.id, time: t.time, question: t.title, direction: t.direction, status: t.status,
      edge: t.edge, confidence: t.confidence, model_prob: t.model_prob, market_prob: t.market_prob,
      positionUsd: t.positionUsd, netPnlUsd: t.netPnlUsd,
      platform: t.platform || t.source, category: t.category,
      days_to_expiry: t.days_to_expiry, end_date: t.end_date,
    })),
    // All predictions for calibration analysis
    predictions: (s.predictions || []).slice(0, 500).map(p => ({
      time: p.time, question: p.question, market_prob: p.market_prob, model_prob: p.model_prob,
      edge: p.edge, confidence: p.confidence, actionable: p.actionable, direction: p.direction,
      llm_providers_used: p.llm_providers_used, llm_estimates: p.llm_estimates,
      llm_rationales: p.llm_rationales,
    })),
    // Research briefs
    research_briefs_sample: (s.research_briefs || []).slice(0, 50).map(b => ({
      market_id: b.market_id, question: b.question, sentiment: b.sentiment, confidence: b.confidence,
      stance: b.stance, source_count: (b.sources || []).length,
      sources_sample: (b.sources || []).slice(0, 3).map(s => ({ title: s.title?.slice(0, 100), source_type: s.source_type, domain: s.domain })),
    })),
    // Configuration
    config: {
      kelly_fraction: s.config?.kelly_fraction, min_edge: s.config?.min_edge,
      max_pos_pct: s.config?.max_pos_pct, max_total_exposure_pct: s.config?.max_total_exposure_pct,
      top_n: s.config?.top_n, scanner_min_volume: s.config?.scanner_min_volume,
      research_min_keyword_overlap: s.config?.research_min_keyword_overlap,
      llm_weights: {
        openai: s.config?.llm_weight_openai, claude: s.config?.llm_weight_claude,
        gemini: s.config?.llm_weight_gemini, ollama_cloud: s.config?.llm_weight_ollama_cloud,
      },
    },
    // Compound summary + nightly reviews
    compound_summary: s.compound_summary,
    nightly_reviews: (s.nightly_reviews || []).slice(0, 14),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="bot-performance-${new Date().toISOString().slice(0,10)}.json"`);
  res.json(exportData);
});

// Full learning data reset — clears everything the bot has "learned" so it starts fresh
app.post('/api/learning/reset', (req, res) => {
  const s = loadState();
  // Clear all learning data
  s.trades = []; s.signals = []; s.orders = [];
  s.execution_runs = []; s.risk_runs = []; s.predict_runs = []; s.research_runs = []; s.scan_runs = [];
  s.predictions = []; s.research_briefs = []; s.scan_results = []; s.markets = [];
  s.prediction_outcomes = []; s.prediction_log = [];
  s.compound_summary = null; s.brier_score = null; s.brier_samples = 0;
  s.nightly_reviews = []; s.pipeline_runs = [];
  s.risk = { peak_bankroll: Number(s.config?.bankroll||1000), drawdown_pct: 0, daily_realized_pnl: 0, open_exposure_usd: 0, open_positions: 0, level: 'OK' };
  s.step3_summary = null; s.step4_summary = null; s.step5_summary = null;
  s.scan_history = {};
  // Clear failure_log.md
  try { const logPath = resolvePath(process.cwd(), 'predict-market-bot', 'references', 'failure_log.md'); if (existsSync(logPath)) writeFileSync(logPath, '# Failure Log\n\nAutomatically maintained by the Compound step.\n\n', 'utf8'); } catch {}
  logLine(s, 'warning', 'FULL LEARNING RESET — all trades, predictions, brier, compound, failure_log cleared');
  saveState(s);
  res.json({ ok: true, message: 'All learning data reset. Bot starts fresh.' });
});

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
app.listen(port, async () => {
  console.log(`Backend listening on http://0.0.0.0:${port}`);
  // On startup: resolve any open forex trades whose expires_at has already passed
  try {
    const s = loadState();
    const now = Date.now();
    const expiredBinary = (s.forex_trades || []).filter(t => t.status === 'OPEN' && new Date(t.expires_at).getTime() < now);
    if (expiredBinary.length > 0) {
      console.log(`[startup] Resolving ${expiredBinary.length} expired binary trades...`);
      await resolveForexTrades(s);
    }
    const openPro = (s.forex_pro_trades || []).filter(t => t.status === 'OPEN').length;
    if (openPro > 0) {
      console.log(`[startup] Checking ${openPro} open pro trades...`);
      await resolveForexProTrades(s);
    }
    saveState(s);
  } catch (e) {
    console.error('[startup] Error resolving open trades:', e.message);
  }
});

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

  // Run learning cycle — observe outcomes, rank sources
  try {
    await runLearningCycle(state);
    const accuracy = analyzePredictionAccuracy(state);
    if (accuracy.ready) {
      state.compound_summary.prediction_accuracy = accuracy.accuracy_pct;
      state.compound_summary.missed_winners = accuracy.missed_winners;
      state.compound_summary.source_ranking = (state.source_ranking || []).slice(0, 5);
    }
  } catch (e) { logLine(state, 'warning', `compound learning error: ${e.message}`); }
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
