// scanner.js — Market scanning, filtering, ranking, history, scheduling

import { loadState, saveState, logLine, nextId } from './appState.js';
import { pushLiveComm } from './utils.js';
import { calcSevenDayVolumeAvg, estimateSlippage, isWithinActiveHours } from './scanCore.js';
import { fetchPolymarketMarkets, fetchKalshiMarkets } from './platforms.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read failure_log.md to learn from past mistakes
function loadFailurePatterns() {
  try {
    const logPath = resolve(process.cwd(), 'predict-market-bot', 'references', 'failure_log.md');
    if (!existsSync(logPath)) return new Set();
    const content = readFileSync(logPath, 'utf8');
    const patterns = new Set();
    // Extract market names from "### Date — Market Name" lines
    const matches = content.match(/^###\s+.+?—\s+(.+)$/gm) || [];
    for (const m of matches) {
      const name = m.replace(/^###\s+.+?—\s+/, '').trim().toLowerCase();
      if (name.length > 3) patterns.add(name);
    }
    return patterns;
  } catch { return new Set(); }
}

export const scannerRuntime = {
  consecutiveFailures: 0,
  breakerUntil: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: '',
  lastDurationMs: 0,
  avgDurationMs: 0,
  runsMeasured: 0,
  lastCoverage: { polymarket: 0, kalshi: 0, total: 0 }
};

export function scanAudit(state, event, details = {}) {
  state.scan_audit_log = state.scan_audit_log || [];
  state.scan_audit_log.unshift({ time: new Date().toISOString(), event, details });
  state.scan_audit_log = state.scan_audit_log.slice(0, 2000);
}

export function scanAndRankMarkets(markets, cfg) {
  const minVolume = Number(cfg.scanner_min_volume || 200);
  const minLiquidity = Number(cfg.scanner_min_liquidity || 200);
  const maxDays = Number(cfg.scanner_max_days || 30);
  const spreadThreshold = Number(cfg.scanner_max_spread || 0.05);
  const priceMoveThreshold = Number(cfg.scanner_price_move_threshold || 0.1);
  const volumeSpikeRatio = Number(cfg.scanner_volume_spike_ratio || 2);
  const minAnomalyScore = Number(cfg.scanner_min_anomaly_score || 1);
  const maxSlippage = Number(cfg.scanner_max_slippage_pct || 0.02);

  // Load past failures to avoid repeating mistakes
  const failurePatterns = loadFailurePatterns();

  // Category filter — let user focus on finance, politics etc.
  const categoryFilter = String(cfg.scanner_market_categories || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const CATEGORY_KEYWORDS = {
    finance: ['stock','s&p','nasdaq','dow','treasury','fed','interest rate','gdp','inflation','earnings','ipo','market cap','bitcoin','btc','eth','crypto','forex'],
    crypto: ['bitcoin','btc','eth','ethereum','crypto','solana','sol','defi','nft','blockchain','binance','coinbase'],
    politics: ['election','president','congress','senate','governor','vote','ballot','democrat','republican','trump','biden','legislation','bill','law','supreme court'],
    sports: ['nfl','nba','mlb','nhl','fifa','world cup','super bowl','championship','playoff','soccer','football','basketball','baseball','tennis','f1','ufc'],
    weather: ['temperature','rain','snow','hurricane','tornado','weather','climate','heat','cold','storm'],
  };

  return markets
    .filter((m) => ['open', 'active', ''].includes(String(m.status || '').toLowerCase()))
    // Category filter
    .filter((m) => {
      if (!categoryFilter.length) return true;
      const q = String(m.question || m.market || '').toLowerCase();
      return categoryFilter.some(cat => {
        const keywords = CATEGORY_KEYWORDS[cat] || [cat];
        return keywords.some(kw => q.includes(kw));
      });
    })
    // Skip markets that match past failures
    .filter((m) => {
      const q = String(m.question || m.market || '').toLowerCase();
      for (const pattern of failurePatterns) {
        if (q.includes(pattern) || pattern.includes(q.slice(0, 20))) return false;
      }
      return true;
    })
    .map((m) => {
      const price = Number(m.market_price || 0);
      const prevPrice = Number(m.prev_market_price || price);
      const spread = Number(m.spread || 0);
      const volume = Number(m.volume || 0);
      const volumeAvg = Number(m.volume_7d_avg || 0);
      const slippage = estimateSlippage(m);
      const priceMove = Math.abs(price - prevPrice);
      const volumeSpike = volumeAvg > 0 ? volume / volumeAvg : 0;
      const anomalies = {
        sudden_price_move: priceMove > priceMoveThreshold,
        wide_spread: spread > spreadThreshold,
        volume_spike: volumeSpike > volumeSpikeRatio
      };
      const anomalyScore = (anomalies.sudden_price_move ? 40 : 0) + (anomalies.wide_spread ? 30 : 0) + (anomalies.volume_spike ? 30 : 0) + Math.min(20, volume / 10000) + Math.min(20, Number(m.liquidity || 0) / 10000);
      return { ...m, estimated_slippage: Number(slippage.toFixed(4)), price_move: Number(priceMove.toFixed(4)), volume_spike_ratio: Number(volumeSpike.toFixed(2)), anomaly_flags: Object.entries(anomalies).filter(([, v]) => v).map(([k]) => k), opportunity_score: Number(anomalyScore.toFixed(2)) };
    })
    .filter((m) => Number(m.volume || 0) >= minVolume)
    .filter((m) => Number(m.liquidity || 0) >= minLiquidity)
    .filter((m) => Number(m.days_to_expiry || 999) <= maxDays)
    .filter((m) => Number(m.opportunity_score || 0) >= minAnomalyScore)
    .filter((m) => Number(m.estimated_slippage || 0) <= maxSlippage)
    .sort((a, b) => b.opportunity_score - a.opportunity_score);
}

export function enrichMarketsWithHistory(state, markets, cfg) {
  const retentionDays = Number(cfg.scanner_history_retention_days || 14);
  const minTs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  state.scan_history = state.scan_history || {};
  return markets.map((market) => {
    const key = `${market.platform}|${market.market}|${market.outcome}`;
    const history = state.scan_history[key] || { price_points: [], volume_points: [] };
    history.price_points = history.price_points.filter((x) => new Date(x.t).getTime() >= minTs);
    history.volume_points = history.volume_points.filter((x) => new Date(x.t).getTime() >= minTs);
    history.price_points.push({ t: new Date().toISOString(), p: Number(market.market_price || 0) });
    history.volume_points.push({ t: new Date().toISOString(), v: Number(market.volume || 0) });
    const prevPrice = history.price_points.length > 1 ? Number(history.price_points[history.price_points.length - 2].p) : Number(market.prev_market_price ?? market.market_price ?? 0.5);
    const rollingVolumeAvg = calcSevenDayVolumeAvg(history.volume_points);
    state.scan_history[key] = history;
    return { ...market, prev_market_price: prevPrice, volume_7d_avg: rollingVolumeAvg > 0 ? Number(rollingVolumeAvg.toFixed(2)) : Number(market.volume_7d_avg || 0) };
  });
}

export function upsertScannedMarkets(state, incoming, sourceLabel, minPrice, maxPrice) {
  let added = 0;
  const existing = new Map(state.markets.map((m) => [`${m.platform}|${m.question}|${m.outcome}`, m]));
  for (const item of incoming) {
    const price = Number(item.market_price || 0);
    if (price < minPrice || price > maxPrice) continue;
    const key = `${item.platform}|${item.question}|${item.outcome}`;
    if (existing.has(key)) Object.assign(existing.get(key), item, { source: sourceLabel });
    else { state.markets.push({ id: nextId(state.markets), ...item, source: sourceLabel }); added += 1; }
  }
  return added;
}

export async function runScanCycle({ persist = true, force = false } = {}) {
  const startedAt = Date.now();
  const state = loadState();
  const cfg = state.config || {};
  const source = String(cfg.scanner_source || 'both');
  const minPrice = Number(cfg.min_market_price || 0.05);
  const maxPrice = Number(cfg.max_market_price || 0.95);
  let added = 0;
  const now = Date.now();

  if (!force && scannerRuntime.breakerUntil > now) {
    const waitSec = Math.ceil((scannerRuntime.breakerUntil - now) / 1000);
    logLine(state, 'warning', `scan skipped: circuit breaker open (${waitSec}s remaining)`);
    scanAudit(state, 'scan_skipped_breaker_open', { wait_sec: waitSec, source });
    if (persist) saveState(state);
    return { state, ranked: state.scan_results || [], added: 0, source, skipped: true, breaker_open: true };
  }
  if (!force && !isWithinActiveHours(cfg)) {
    logLine(state, 'info', 'scan skipped: outside active hours');
    scanAudit(state, 'scan_skipped_outside_active_hours', { source });
    if (persist) saveState(state);
    return { state, ranked: state.scan_results || [], added: 0, source, skipped: true };
  }

  scanAudit(state, 'scan_started', { source, force, min_price: minPrice, max_price: maxPrice });
  pushLiveComm('scan_started', { source, force: Boolean(force) });

  if (source === 'polymarket') {
    const markets = await fetchPolymarketMarkets(300);
    added = upsertScannedMarkets(state, markets, 'polymarket-api', minPrice, maxPrice);
    scanAudit(state, 'scan_source_processed', { source: 'polymarket', fetched: markets.length, added });
  } else if (source === 'kalshi') {
    const markets = await fetchKalshiMarkets(300);
    added = upsertScannedMarkets(state, markets, 'kalshi-api', minPrice, maxPrice);
    scanAudit(state, 'scan_source_processed', { source: 'kalshi', fetched: markets.length, added });
  } else {
    const polymarket = await fetchPolymarketMarkets(300);
    const kalshi = await fetchKalshiMarkets(300);
    added = upsertScannedMarkets(state, [...polymarket, ...kalshi], 'both-api', minPrice, maxPrice);
    scanAudit(state, 'scan_source_processed', { source: 'both', fetched_total: polymarket.length + kalshi.length, added });
  }

  state.markets = enrichMarketsWithHistory(state, state.markets || [], cfg);
  const ranked = scanAndRankMarkets(state.markets || [], cfg);
  state.scan_results = ranked.slice(0, Number(cfg.top_n || 10));
  state.scan_runs = state.scan_runs || [];
  state.scan_runs.unshift({ time: new Date().toISOString(), source, scanned_total: state.markets.length, tradeable_count: ranked.length, added });
  state.scan_runs = state.scan_runs.slice(0, 100);
  logLine(state, 'info', `scan cycle complete source=${source} tradeable=${ranked.length} added=${added}`);

  scannerRuntime.consecutiveFailures = 0;
  scannerRuntime.breakerUntil = 0;
  scannerRuntime.lastSuccessAt = new Date().toISOString();
  scannerRuntime.lastError = '';
  const duration = Date.now() - startedAt;
  scannerRuntime.lastDurationMs = duration;
  scannerRuntime.runsMeasured += 1;
  scannerRuntime.avgDurationMs = Number((((scannerRuntime.avgDurationMs * (scannerRuntime.runsMeasured - 1)) + duration) / scannerRuntime.runsMeasured).toFixed(2));
  scannerRuntime.lastCoverage = { polymarket: state.markets.filter((m) => m.platform === 'polymarket').length, kalshi: state.markets.filter((m) => m.platform === 'kalshi').length, total: state.markets.length };
  scanAudit(state, 'scan_completed', { source, duration_ms: duration, added, tradeable_count: ranked.length, scanned_total: state.markets.length, coverage: scannerRuntime.lastCoverage });
  pushLiveComm('scan_completed', { source, tradeable_count: ranked.length, scanned_total: state.markets.length, duration_ms: duration });

  if (persist) saveState(state);
  return { state, ranked, added, source };
}

export function onScanFailure(error, cfg = {}) {
  scannerRuntime.consecutiveFailures += 1;
  scannerRuntime.lastFailureAt = new Date().toISOString();
  scannerRuntime.lastError = String(error?.message || error || 'scan failed');
  const threshold = Math.max(1, Number(cfg.scanner_breaker_threshold || 3));
  const cooldownSec = Math.max(30, Number(cfg.scanner_breaker_cooldown_sec || 300));
  if (scannerRuntime.consecutiveFailures >= threshold) {
    scannerRuntime.breakerUntil = Date.now() + cooldownSec * 1000;
  }
}

let scanTimer = null;
export function ensureScanScheduler() {
  const state = loadState();
  const everyMinutes = Math.max(15, Math.min(30, Number(state.config.scan_interval_minutes || 15)));
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = setInterval(() => {
    runScanCycle().catch((e) => {
      const s = loadState();
      onScanFailure(e, s.config || {});
      logLine(s, 'error', `scheduled scan failed: ${e.message}`);
      scanAudit(s, 'scan_failed_scheduled', { error: e.message });
      saveState(s);
    });
  }, everyMinutes * 60 * 1000);
}
