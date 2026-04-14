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
    const matches = content.match(/^###\s+.+?—\s+(.+)$/gm) || [];
    for (const m of matches) {
      const name = m.replace(/^###\s+.+?—\s+/, '').trim().toLowerCase();
      if (name.length > 10) patterns.add(name); // Only skip exact matches, not short words
    }
    return patterns;
  } catch { return new Set(); }
}

export const scannerRuntime = {
  consecutiveFailures: 0, breakerUntil: 0, lastSuccessAt: null,
  lastFailureAt: null, lastError: '', lastDurationMs: 0,
  avgDurationMs: 0, runsMeasured: 0,
  lastCoverage: { polymarket: 0, kalshi: 0, total: 0 },
  lastFilterStats: {}, // Track why markets got filtered
};

export function scanAudit(state, event, details = {}) {
  state.scan_audit_log = state.scan_audit_log || [];
  state.scan_audit_log.unshift({ time: new Date().toISOString(), event, details });
  state.scan_audit_log = state.scan_audit_log.slice(0, 2000);
}

export function scanAndRankMarkets(markets, cfg) {
  const minVolume = Number(cfg.scanner_min_volume || 200);
  const minLiquidity = Number(cfg.scanner_min_liquidity || 0); // Default 0 — many markets have 0 liquidity field
  const maxDays = Number(cfg.scanner_max_days || 90); // 90 days default, not 30
  const maxSlippage = Number(cfg.scanner_max_slippage_pct || 0.10); // 10% default, not 2%
  const minPrice = Number(cfg.min_market_price || 0.05);
  const maxPrice = Number(cfg.max_market_price || 0.95);

  const failurePatterns = loadFailurePatterns();

  // Category filter
  const categoryFilter = String(cfg.scanner_market_categories || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const CATEGORY_KEYWORDS = {
    finance: ['stock','s&p','nasdaq','dow','treasury','fed','interest rate','gdp','inflation','earnings','ipo','forex','bond','yield','recession','unemployment','jobs','cpi','fomc'],
    crypto: ['bitcoin','btc','eth','ethereum','crypto','solana','defi','blockchain','binance','coinbase','dogecoin','xrp'],
    politics: ['election','president','congress','senate','governor','vote','democrat','republican','trump','biden','legislation','bill','law','supreme court','impeach','nomination'],
    sports: ['nfl','nba','mlb','nhl','fifa','world cup','super bowl','championship','playoff','soccer','football','basketball','baseball','tennis','f1','ufc','olympics'],
    weather: ['temperature','rain','snow','hurricane','tornado','weather','storm','flood','wildfire'],
    tech: ['openai','google','apple','microsoft','nvidia','spacex','semiconductor','quantum','robot'],
    entertainment: ['oscar','grammy','emmy','movie','film','netflix','disney','streaming','award'],
    economy: ['gdp','unemployment','tariff','sanction','housing','mortgage','debt','bankruptcy'],
    legal: ['trial','verdict','guilty','lawsuit','indictment','ruling','court','settlement'],
    geopolitics: ['war','conflict','nato','china','russia','ukraine','taiwan','iran','israel','ceasefire'],
  };

  // Track filter stats for debugging
  const stats = { input: markets.length };

  const result = markets
    .filter((m) => {
      const s = String(m.status || '').toLowerCase();
      return ['open', 'active', ''].includes(s);
    })
    // Remove expired markets (end_date in the past)
    .filter((m) => {
      if (m.end_date) {
        const endMs = new Date(m.end_date).getTime();
        if (endMs < Date.now()) return false;
      }
      if (Number(m.days_to_expiry) <= 0) return false;
      return true;
    });
  stats.after_status = result.length;

  const afterCategory = result.filter((m) => {
      if (!categoryFilter.length) return true;
      const q = String(m.question || m.market || '').toLowerCase();
      return categoryFilter.some(cat => {
        const keywords = CATEGORY_KEYWORDS[cat] || [cat];
        return keywords.some(kw => q.includes(kw));
      });
    });
  stats.after_category = afterCategory.length;

  const afterFailure = afterCategory.filter((m) => {
      if (!failurePatterns.size) return true;
      const q = String(m.question || '').toLowerCase();
      for (const pattern of failurePatterns) {
        if (q === pattern) return false;
      }
      return true;
    });
  stats.after_failure = afterFailure.length;

  const afterPrice = afterFailure.filter((m) => {
      const p = Number(m.market_price || 0);
      return p >= minPrice && p <= maxPrice;
    });
  stats.after_price = afterPrice.length;

  const afterVolume = afterPrice.filter((m) => Number(m.volume || 0) >= minVolume);
  stats.after_volume = afterVolume.length;

  const afterLiquidity = afterVolume.filter((m) => minLiquidity <= 0 || Number(m.liquidity || 0) >= minLiquidity);
  stats.after_liquidity = afterLiquidity.length;

  const afterDays = afterLiquidity.filter((m) => Number(m.days_to_expiry || 999) <= maxDays);
  stats.after_days = afterDays.length;

  const afterSlippage = afterDays.filter((m) => estimateSlippage(m) <= maxSlippage);
  stats.after_slippage = afterSlippage.length;

  // Console log the filter breakdown for docker logs
  console.log(`[scanner] Filter: ${stats.input} → status:${stats.after_status} → cat:${stats.after_category} → fail:${stats.after_failure} → price:${stats.after_price} → vol(≥${minVolume}):${stats.after_volume} → liq(≥${minLiquidity}):${stats.after_liquidity} → days(≤${maxDays}):${stats.after_days} → slip(≤${maxSlippage}):${stats.after_slippage}`);

  if (afterSlippage.length === 0 && markets.length > 0) {
    const sample = markets[0];
    console.log(`[scanner] ALL FILTERED! Sample: "${(sample.question||'').slice(0,50)}" price=${sample.market_price} vol=${sample.volume} liq=${sample.liquidity} days=${sample.days_to_expiry} slip=${estimateSlippage(sample).toFixed(4)}`);
  }

  const scored = afterSlippage
    .map((m) => {
      const price = Number(m.market_price || 0);
      const prevPrice = Number(m.prev_market_price || price);
      const spread = Number(m.spread || 0);
      const volume = Number(m.volume || 0);
      const volumeAvg = Number(m.volume_7d_avg || 0);
      const priceMove = Math.abs(price - prevPrice);
      const volumeSpike = volumeAvg > 0 ? volume / volumeAvg : 1;
      const anomalies = {
        sudden_price_move: priceMove > 0.10,
        wide_spread: spread > 0.05,
        volume_spike: volumeSpike > 2
      };
      const volumeScore = Math.min(30, Math.log10(Math.max(1, volume)) * 6);
      const liquidityScore = Math.min(20, Math.log10(Math.max(1, Number(m.liquidity || 1))) * 4);
      const edgePotential = Math.min(20, Math.abs(price - 0.5) * 40);
      const anomalyBonus = (anomalies.sudden_price_move ? 15 : 0) + (anomalies.wide_spread ? 5 : 0) + (anomalies.volume_spike ? 10 : 0);
      const score = volumeScore + liquidityScore + edgePotential + anomalyBonus;
      return {
        ...m,
        estimated_slippage: Number(estimateSlippage(m).toFixed(4)),
        price_move: Number(priceMove.toFixed(4)),
        volume_spike_ratio: Number(volumeSpike.toFixed(2)),
        anomaly_flags: Object.entries(anomalies).filter(([, v]) => v).map(([k]) => k),
        opportunity_score: Number(score.toFixed(2))
      };
    })
    .sort((a, b) => b.opportunity_score - a.opportunity_score);

  console.log(`[scanner] Final result: ${scored.length} tradeable markets`);
  stats.output = scored.length;
  scannerRuntime.lastFilterStats = stats;
  return scored;
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
    if (persist) saveState(state);
    return { state, ranked: state.scan_results || [], added: 0, source, skipped: true };
  }

  scanAudit(state, 'scan_started', { source, force });
  pushLiveComm('scan_started', { source, force: Boolean(force) });

  try {
    if (source === 'polymarket') {
      const markets = await fetchPolymarketMarkets(300);
      added = upsertScannedMarkets(state, markets, 'polymarket-api', minPrice, maxPrice);
      logLine(state, 'info', `polymarket: fetched ${markets.length} raw, added ${added} new`);
    } else if (source === 'kalshi') {
      const markets = await fetchKalshiMarkets(300);
      added = upsertScannedMarkets(state, markets, 'kalshi-api', minPrice, maxPrice);
      logLine(state, 'info', `kalshi: fetched ${markets.length} raw, added ${added} new`);
    } else {
      let pmCount = 0, kaCount = 0;
      try { const pm = await fetchPolymarketMarkets(300); pmCount = pm.length; added += upsertScannedMarkets(state, pm, 'polymarket-api', minPrice, maxPrice); } catch (e) { logLine(state, 'warning', `polymarket fetch failed: ${e.message}`); }
      try { const ka = await fetchKalshiMarkets(300); kaCount = ka.length; added += upsertScannedMarkets(state, ka, 'kalshi-api', minPrice, maxPrice); } catch (e) { logLine(state, 'warning', `kalshi fetch failed: ${e.message}`); }
      logLine(state, 'info', `scan: pm=${pmCount} ka=${kaCount} added=${added} total_in_db=${state.markets.length}`);
      if (pmCount === 0 && kaCount === 0) logLine(state, 'error', 'scan: BOTH APIs returned 0 markets! Check network connectivity.');
    }
  } catch (e) {
    logLine(state, 'error', `scan fetch error: ${e.message}`);
  }

  // Purge expired markets from DB
  const beforePurge = state.markets.length;
  state.markets = (state.markets || []).filter(m => {
    if (m.end_date) { const endMs = new Date(m.end_date).getTime(); if (endMs < Date.now()) return false; }
    if (Number(m.days_to_expiry) <= 0) return false;
    return true;
  });
  const purged = beforePurge - state.markets.length;
  if (purged > 0) logLine(state, 'info', `scan: purged ${purged} expired markets from DB`);

  state.markets = enrichMarketsWithHistory(state, state.markets || [], cfg);
  const ranked = scanAndRankMarkets(state.markets || [], cfg);
  state.scan_results = ranked.slice(0, Number(cfg.top_n || 10));

  // Log filter results so user can see why markets get filtered
  const filterStats = scannerRuntime.lastFilterStats || {};
  if (ranked.length === 0 && state.markets.length > 0) {
    logLine(state, 'warning', `scan: ${state.markets.length} markets in DB but 0 passed filters! Filter reasons in docker logs.`);
  }
  logLine(state, 'info', `scan result: ${state.markets.length} total → ${ranked.length} tradeable → top ${state.scan_results.length}`);

  state.scan_runs = state.scan_runs || [];
  state.scan_runs.unshift({ time: new Date().toISOString(), source, scanned_total: state.markets.length, tradeable_count: ranked.length, added, filter_stats: scannerRuntime.lastFilterStats });
  state.scan_runs = state.scan_runs.slice(0, 100);
  state.scanner_health = { total: state.markets.length, tradeable: ranked.length, filter_stats: scannerRuntime.lastFilterStats };

  logLine(state, 'info', `scan complete: ${state.markets.length} total → ${ranked.length} tradeable (filters: ${JSON.stringify(scannerRuntime.lastFilterStats)})`);

  scannerRuntime.consecutiveFailures = 0;
  scannerRuntime.breakerUntil = 0;
  scannerRuntime.lastSuccessAt = new Date().toISOString();
  scannerRuntime.lastError = '';
  const duration = Date.now() - startedAt;
  scannerRuntime.lastDurationMs = duration;
  scannerRuntime.runsMeasured += 1;
  scannerRuntime.avgDurationMs = Number((((scannerRuntime.avgDurationMs * (scannerRuntime.runsMeasured - 1)) + duration) / scannerRuntime.runsMeasured).toFixed(2));
  scannerRuntime.lastCoverage = { polymarket: state.markets.filter((m) => m.platform === 'polymarket').length, kalshi: state.markets.filter((m) => m.platform === 'kalshi').length, total: state.markets.length };

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
  const everyMinutes = Math.max(5, Math.min(60, Number(state.config.scan_interval_minutes || 15)));
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = setInterval(() => {
    runScanCycle().catch((e) => {
      const s = loadState();
      onScanFailure(e, s.config || {});
      logLine(s, 'error', `scheduled scan failed: ${e.message}`);
      saveState(s);
    });
  }, everyMinutes * 60 * 1000);
}
