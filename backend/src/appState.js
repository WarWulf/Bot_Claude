import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(process.cwd(), 'data');
const STATE_FILE = resolve(DATA_DIR, 'state.json');

function nowUtc() {
  return new Date().toISOString();
}

export function defaultState() {
  return {
    config: {
      bankroll: 1000,
      starting_bankroll: 1000,
      top_n: 10,
      interval_sec: 300,
      scan_interval_minutes: 15,
      kelly_fraction: 0.25,
      max_pos_pct: 0.05,
      min_edge: 0.04,
      paper_mode: true,
      provider: 'ollama_cloud',
      auto_running: false,
      scanner_source: 'both',
      min_market_price: 0.05,
      max_market_price: 0.95,
      max_total_exposure_pct: 0.5,
      paper_trade_risk_pct: 0.02,
      max_concurrent_positions: 15,
      max_drawdown_pct: 0.08,
      daily_loss_limit_pct: 0.15,
      kill_switch: false,
      scanner_min_volume: 100,
      scanner_min_liquidity: 0,
      scanner_max_days: 90,
      scanner_min_anomaly_score: 0,
      step1_min_tradeable: 5,
      scanner_max_spread: 0.05,
      scanner_price_move_threshold: 0.1,
      scanner_volume_spike_ratio: 2,
      scanner_active_from_utc: 0,
      scanner_active_to_utc: 24,
      scanner_ws_enabled: false,
      scanner_ws_auto_reconnect: true,
      polymarket_ws_url: '',
      kalshi_ws_url: '',
      scanner_max_slippage_pct: 0.15,
      scanner_history_retention_days: 14,
      model_prob_offset: 0,
      scanner_http_retries: 2,
      scanner_http_timeout_ms: 8000,
      scanner_breaker_threshold: 3,
      scanner_breaker_cooldown_sec: 300,
      research_rss_feeds: [
        'https://feeds.reuters.com/reuters/topNews',
        'https://feeds.reuters.com/reuters/businessNews',
        'https://feeds.bbci.co.uk/news/world/rss.xml',
        'https://feeds.bbci.co.uk/news/business/rss.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
        'https://www.cnbc.com/id/100003114/device/rss/rss.html',
        'https://feeds.marketwatch.com/marketwatch/topstories',
        'https://www.ft.com/?format=rss',
        'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362',
        'https://rss.app/feeds/v1.1/tgFMjhk7QXQlNOqd.xml',
      ].join(','),
      research_source_rss: true,
      research_source_newsapi: false,
      research_newsapi_key: '',
      research_newsapi_query: '(election OR federal reserve OR crypto OR bitcoin OR trade war OR GDP OR inflation OR AI OR congress)',
      research_source_gdelt: false,
      research_gdelt_query: '(election OR federal reserve OR bitcoin OR NATO OR trade OR GDP OR inflation)',
      research_reddit_subreddits: 'worldnews,politics,economics,CryptoCurrency,wallstreetbets,PredictionMarkets,geopolitics,technology',
      research_reddit_query: 'election OR bitcoin OR fed OR trade OR war OR AI OR inflation OR crypto',
      research_max_headlines: 80,
      research_min_keyword_overlap: 1,
      research_min_credibility: 0.4,
      step3_min_edge: 0.03,
      step3_min_confidence: 0.55,
      llm_enabled: true,
      llm_require_provider: false,
      llm_timeout_ms: 25000,
      llm_retries: 2,
      llm_delay_between_markets_ms: 4000,
      llm_max_tokens: 500,
      strategy_version: 3, // v3: Superforecaster prompt with decomposition + base rates

      // Forex / Binary Options signals
      forex_api_key: '',
      forex_data_provider: 'twelvedata', // 'twelvedata' or 'alphavantage'
      forex_pairs: 'EUR/USD,GBP/USD,USD/JPY,AUD/USD',
      forex_interval: '5min', // 1min, 5min, 15min, 30min, 1h
      forex_min_confidence: 0.35,
      forex_bankroll: 100,
      forex_payout_pct: 85,
      forex_max_concurrent: 2,
      forex_default_duration: 3,
      forex_default_amount: 5,
      forex_auto_enabled: false,
      forex_auto_interval_min: 5,
      forex_auto_min_score: 0.5,
      // Realism (spread & slippage simulation)
      forex_spread_pips: 1.5,
      forex_slippage_pips: 0.5,
      forex_simulate_spread: true,
      forex_correlation_check: true,

      // Forex Pro (SL/TP)
      forex_pro_bankroll: 1000,
      forex_pro_risk_pct: 0.02,
      forex_pro_default_sl: 20,
      forex_pro_default_tp: 30,
      forex_pro_max_concurrent: 3,
      llm_temperature: 0.1,
      llm_weight_openai: 0.35,
      llm_weight_claude: 0.25,
      llm_weight_gemini: 0.2,
      llm_weight_ollama_cloud: 0.2,
      log_to_file: true,
      log_retention_days: 14,
      // Rate Limiting (API hardening)
      rate_limit_enabled: false,
      rate_limit_per_minute: 60,
    },
    providers: {
      polymarket: { wallet_address: '', eip712_signature: '', enabled: true },
      kalshi: { key_id: '', key_secret: '', enabled: true },
      openai: { api_key: '', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', enabled: false },
      claude: { api_key: '', base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest', enabled: false },
      gemini: { api_key: '', base_url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', enabled: false },
      ollama_cloud: { api_key: '', base_url: 'https://ollama.com/v1', model: 'kimi-k2.5:cloud', enabled: true },
      kimi_direct: { api_key: '', base_url: 'https://api.moonshot.ai/v1', model: 'kimi-k2.5', enabled: false },
      local_ollama: { api_key: '', base_url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:14b', enabled: false }
    },
    markets: [],
    scan_results: [],
    scan_runs: [],
    scan_audit_log: [],
    scan_history: {},
    research_briefs: [],
    research_summary: {
      completed_at: null,
      analyzed_markets: 0,
      avg_confidence: 0,
      avg_evidence_score: 0,
      source_diversity: 0,
      coverage_pct: 0
    },
    research_runs: [],
    predictions: [],
    predict_runs: [],
    step3_summary: {
      completed_at: null,
      predicted_markets: 0,
      avg_edge: 0,
      avg_model_prob: 0,
      actionable_pct: 0
    },
    execution_runs: [],
    step4_summary: {
      completed_at: null,
      candidate_signals: 0,
      executed_orders: 0,
      skipped_orders: 0,
      opened_trades: 0,
      risk_blocked_orders: 0,
      paper_mode: true
    },
    risk_runs: [],
    step5_summary: {
      completed_at: null,
      checked_positions: 0,
      violations: 0,
      max_position_pct: 0,
      total_exposure_pct: 0
    },
    pipeline_runs: [],
    scan_recommendation_log: [],
    ws_ticks: [],
    signals: [],
    trades: [],
    runs: [],
    performance: [{ time: 'start', bankroll: 1000, delta: 0, reason: 'start' }],
    risk: {
      open_exposure_usd: 0,
      open_positions: 0,
      peak_bankroll: 1000,
      drawdown_pct: 0,
      daily_realized_pnl: 0,
      blocked_reason: '',
      last_risk_checks: []
    },
    logs: []
  };
}

let _backupCheckedToday = null;

function _maybeBackup(state) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (_backupCheckedToday === today) return;
    _backupCheckedToday = today;
    const backupDir = `${dirname(STATE_FILE)}/backups`;
    mkdirSync(backupDir, { recursive: true });
    const backupFile = `${backupDir}/state-${today}.json`;
    if (!existsSync(backupFile)) {
      writeFileSync(backupFile, JSON.stringify(state), 'utf8');
      // Keep only 7 most recent
      const files = readdirSync(backupDir).filter(f => f.startsWith('state-') && f.endsWith('.json')).sort().reverse();
      for (const old of files.slice(7)) {
        try { unlinkSync(`${backupDir}/${old}`); } catch {}
      }
    }
  } catch {}
}

export function loadState() {
  const base = defaultState();
  if (!existsSync(STATE_FILE)) {
    return base;
  }
  try {
    const loaded = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    _maybeBackup(loaded);
    return {
      ...base,
      ...loaded,
      config: { ...base.config, ...(loaded.config || {}) },
      providers: { ...base.providers, ...(loaded.providers || {}) }
    };
  } catch (e) {
    console.error('[loadState] Parse error, attempting recovery:', e.message);
    // Try recovery from most recent backup
    try {
      const backupDir = `${dirname(STATE_FILE)}/backups`;
      if (existsSync(backupDir)) {
        const files = readdirSync(backupDir).filter(f => f.startsWith('state-') && f.endsWith('.json')).sort().reverse();
        if (files.length > 0) {
          const latest = `${backupDir}/${files[0]}`;
          console.log(`[loadState] Recovering from ${latest}`);
          const recovered = JSON.parse(readFileSync(latest, 'utf8'));
          return {
            ...base, ...recovered,
            config: { ...base.config, ...(recovered.config || {}) },
            providers: { ...base.providers, ...(recovered.providers || {}) }
          };
        }
      }
    } catch {}
    return base;
  }
}

// ═══ SAVE QUEUE — prevents race conditions when multiple timers save concurrently ═══
let _saving = false;
let _savePending = null;

async function _doSave(state) {
  // Cleanup arrays
  if (state.logs) state.logs = state.logs.slice(0, 300);
  if (state.scan_runs) state.scan_runs = state.scan_runs.slice(0, 50);
  if (state.scan_audit_log) state.scan_audit_log = state.scan_audit_log.slice(0, 500);
  if (state.research_runs) state.research_runs = state.research_runs.slice(0, 50);
  if (state.predict_runs) state.predict_runs = state.predict_runs.slice(0, 50);
  if (state.execution_runs) state.execution_runs = state.execution_runs.slice(0, 50);
  if (state.risk_runs) state.risk_runs = state.risk_runs.slice(0, 50);
  if (state.pipeline_runs) state.pipeline_runs = state.pipeline_runs.slice(0, 50);
  if (state.nightly_reviews) state.nightly_reviews = state.nightly_reviews.slice(0, 30);
  if (state.predictions) state.predictions = state.predictions.slice(0, 200);
  if (state.trades) state.trades = state.trades.slice(0, 500);
  if (state.orders) state.orders = state.orders.slice(0, 500);
  if (state.signals) state.signals = state.signals.slice(0, 200);
  if (state.research_briefs) state.research_briefs = state.research_briefs.slice(0, 50);
  if (state.prediction_outcomes) state.prediction_outcomes = state.prediction_outcomes.slice(0, 200);
  if (state.forex_trades) state.forex_trades = state.forex_trades.slice(0, 500);
  if (state.forex_pro_trades) state.forex_pro_trades = state.forex_pro_trades.slice(0, 500);
  if (state.forex_runs) state.forex_runs = state.forex_runs.slice(0, 50);
  if (state.forex_signal_log) state.forex_signal_log = state.forex_signal_log.slice(0, 300);
  if (state.forex_llm_log) state.forex_llm_log = state.forex_llm_log.slice(0, 200);
  if (state.forex_news_history) state.forex_news_history = state.forex_news_history.slice(0, 200);
  if (state.forex_news_trade_log) state.forex_news_trade_log = state.forex_news_trade_log.slice(0, 200);
  if (state.llm_prompt_log) state.llm_prompt_log = state.llm_prompt_log.slice(0, 100);
  if (state.manual_trade_plans) state.manual_trade_plans = state.manual_trade_plans.slice(0, 100);
  if (state.news_digest?.items) state.news_digest.items = state.news_digest.items.slice(0, 30);
  if (state.scan_history) {
    const keys = Object.keys(state.scan_history);
    if (keys.length > 100) {
      const toDelete = keys.slice(100);
      for (const k of toDelete) delete state.scan_history[k];
    }
    for (const k of Object.keys(state.scan_history)) {
      const h = state.scan_history[k];
      if (h.price_points) h.price_points = h.price_points.slice(-20);
      if (h.volume_points) h.volume_points = h.volume_points.slice(-20);
    }
  }

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmpFile = `${STATE_FILE}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmpFile, STATE_FILE);
}

export function saveState(state) {
  // If already saving, queue this one — only latest gets saved
  if (_saving) {
    _savePending = state;
    return;
  }

  _saving = true;
  try {
    _doSave(state);
  } finally {
    _saving = false;
    // If another save was queued while we were saving, do it now
    if (_savePending) {
      const queued = _savePending;
      _savePending = null;
      saveState(queued);
    }
  }
}

// Debounced save — coalesces multiple calls within delayMs
let _debounceTimer = null;
let _debounceState = null;
export function saveStateDebounced(state, delayMs = 2000) {
  _debounceState = state;
  if (_debounceTimer) return;
  _debounceTimer = setTimeout(() => {
    const s = _debounceState;
    _debounceTimer = null;
    _debounceState = null;
    if (s) saveState(s);
  }, delayMs);
}

export function flushDebouncedSave() {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    if (_debounceState) {
      saveState(_debounceState);
      _debounceState = null;
    }
  }
}

export function logLine(state, level, msg) {
  state.logs = state.logs || [];
  const entry = { time: nowUtc(), level, msg };
  state.logs.unshift(entry);
  state.logs = state.logs.slice(0, 300);
  writeDailyLogEntry(entry, state.config || {});
}

function writeDailyLogEntry(entry, cfg = {}) {
  if (cfg.log_to_file === false) return;
  try {
    const retentionDays = Math.max(1, Number(cfg.log_retention_days || 14));
    const logDir = resolve(DATA_DIR, 'logs');
    mkdirSync(logDir, { recursive: true });
    const day = String(entry.time || nowUtc()).slice(0, 10);
    const filePath = resolve(logDir, `app-${day}.log`);
    appendFileSync(filePath, `${entry.time} [${String(entry.level || 'info').toUpperCase()}] ${entry.msg}\n`, 'utf8');

    const files = readdirSync(logDir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f));
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const full = resolve(logDir, file);
      const st = statSync(full);
      if (st.mtimeMs < cutoff) unlinkSync(full);
    }
  } catch {
    // file logging must never break runtime logic
  }
}

export function maskProviderKeys(state) {
  const clone = JSON.parse(JSON.stringify(state));
  for (const provider of Object.values(clone.providers || {})) {
    for (const [key, value] of Object.entries(provider || {})) {
      const sensitive = /key|secret|signature|token|pass/i.test(String(key));
      if (sensitive && value) {
        provider[key] = '********';
      }
    }
  }
  return clone;
}

export function nextId(items) {
  return Math.max(0, ...items.map((x) => Number(x.id || 0))) + 1;
}

export function buildScannerHealth(markets, cfg = {}) {
  const health = {
    total: markets.length,
    open: 0,
    polymarket: 0,
    kalshi: 0,
    with_volume: 0,
    with_liquidity: 0,
    scanner_source: String(cfg.scanner_source || 'both'),
    scan_interval_minutes: Number(cfg.scan_interval_minutes || 15),
    min_volume: Number(cfg.scanner_min_volume || 100),
    min_liquidity: Number(cfg.scanner_min_liquidity || 0),
    max_days: Number(cfg.scanner_max_days || 90),
    min_anomaly_score: Number(cfg.scanner_min_anomaly_score || 0),
    active_from_utc: Number(cfg.scanner_active_from_utc ?? 0),
    active_to_utc: Number(cfg.scanner_active_to_utc ?? 24),
    ws_enabled: Boolean(cfg.scanner_ws_enabled),
    ws_auto_reconnect: Boolean(cfg.scanner_ws_auto_reconnect),
    max_slippage_pct: Number(cfg.scanner_max_slippage_pct || 0.15)
  };

  for (const m of markets) {
    const platform = String(m.platform || '').toLowerCase();
    const status = String(m.status || '').toLowerCase();
    if (!status || status === 'open' || status === 'active') health.open += 1;
    if (platform === 'polymarket') health.polymarket += 1;
    if (platform === 'kalshi') health.kalshi += 1;
    if (Number(m.volume || 0) > 0) health.with_volume += 1;
    if (Number(m.liquidity || 0) > 0) health.with_liquidity += 1;
  }
  return health;
}
