// pipeline.js — Full pipeline orchestration, step status, improvement reports, recommendations

import { loadState, saveState } from './appState.js';
import { scannerRuntime, runScanCycle, scanAndRankMarkets } from './scanner.js';
import { runResearchStep } from './research.js';
import { runPredictStep, queryLlmProvider } from './predict.js';
import { runExecutionStep } from './execution.js';
import { runRiskStep } from './riskEngine.js';
import { buildPolymarketAuthHeaders, buildKalshiAuthHeaders } from './platforms.js';

export async function runSkillPipeline({ runScan = true, runResearch = true, runPredict = true, runExecute = true, runRisk = true } = {}) {
  const trace = [];
  if (runScan) { const out = await runScanCycle({ force: true }); trace.push({ step: 1, key: 'scan', tradeable: out?.ranked?.length || 0 }); }
  if (runResearch) { const out = await runResearchStep(); trace.push({ step: 2, key: 'research', briefs: out?.briefs?.length || 0 }); }
  if (runPredict) { const state = loadState(); const out = await runPredictStep(state); trace.push({ step: 3, key: 'predict', predictions: out?.predictions?.length || 0 }); }
  if (runExecute) { const state = loadState(); const out = await runExecutionStep(state); trace.push({ step: 4, key: 'execute', executed_orders: out?.summary?.executed_orders || 0 }); }
  if (runRisk) { const state = loadState(); const out = await runRiskStep(state); trace.push({ step: 5, key: 'risk', violations: out?.summary?.violations || 0 }); }
  const state = loadState();
  state.pipeline_runs = state.pipeline_runs || [];
  state.pipeline_runs.unshift({ time: new Date().toISOString(), trace });
  state.pipeline_runs = state.pipeline_runs.slice(0, 100);
  saveState(state);
  return { run: state.pipeline_runs[0], trace, step_status: computeStepStatus(state) };
}

export function computeStep1Readiness(state = loadState()) {
  const cfg = state.config || {};
  const minTradeable = Math.max(1, Number(cfg.step1_min_tradeable || 5));
  const lastRun = (state.scan_runs || [])[0] || null;
  const lastRunAtMs = lastRun?.time ? new Date(lastRun.time).getTime() : 0;
  const staleAfterMs = Math.max(10, Number(cfg.scan_interval_minutes || 15)) * 60 * 1000 * 2;
  const isFresh = Boolean(lastRunAtMs && (Date.now() - lastRunAtMs) <= staleAfterMs);
  const tradeableCount = Number(lastRun?.tradeable_count || (state.scan_results || []).length || 0);
  return { min_tradeable_target: minTradeable, tradeable_count: tradeableCount, fresh_scan: isFresh, breaker_closed: scannerRuntime.breakerUntil <= Date.now(), ready: isFresh && tradeableCount >= minTradeable && scannerRuntime.breakerUntil <= Date.now() };
}

export function runStep1SelfTest(state = loadState()) {
  const cfg = state.config || {};
  const pm = buildPolymarketAuthHeaders();
  const ka = buildKalshiAuthHeaders();
  const sample = [
    { platform: 'polymarket', question: 'Will the S&P 500 close above 5800 this week? (finance stock market test)', market: 'SAMPLE1', market_price: 0.45, prev_market_price: 0.4, bid: 0.44, ask: 0.46, spread: 0.02, status: 'open', volume: 999999, volume_7d_avg: 500000, liquidity: 999999, days_to_expiry: 7 },
    { platform: 'kalshi', question: 'Will bitcoin BTC reach $100k? (crypto election politics test)', market: 'SAMPLE2', market_price: 0.55, prev_market_price: 0.5, bid: 0.53, ask: 0.57, spread: 0.04, status: 'open', volume: 999999, volume_7d_avg: 500000, liquidity: 999999, days_to_expiry: 14 }
  ];
  const ranked = scanAndRankMarkets(sample, cfg);
  const readiness = computeStep1Readiness(state);
  const checks = [
    { key: 'scheduler_config_valid', ok: Number(cfg.scan_interval_minutes || 0) >= 5 && Number(cfg.scan_interval_minutes || 0) <= 60, desc: 'Scan-Intervall zwischen 5 und 60 Minuten' },
    { key: 'breaker_config_valid', ok: Number(cfg.scanner_breaker_threshold || 0) >= 1 && Number(cfg.scanner_breaker_cooldown_sec || 0) >= 30, desc: 'Circuit Breaker korrekt konfiguriert' },
    { key: 'scan_pipeline_ranked', ok: Array.isArray(ranked) && ranked.length > 0, desc: 'Scanner kann Märkte ranken (Test mit Beispieldaten)' },
    { key: 'runtime_present', ok: typeof scannerRuntime.breakerUntil === 'number', desc: 'Scanner-Runtime initialisiert' },
    { key: 'auth_configured_any', ok: Boolean(pm['x-pm-address'] && pm['x-pm-signature']) || Boolean(ka['KALSHI-ACCESS-KEY'] && ka['KALSHI-ACCESS-SIGNATURE']) || (state.scan_results || []).length > 0, desc: 'Mindestens eine Börse erreichbar oder Scan hat Ergebnisse' },
    { key: 'recent_scan_fresh', ok: readiness.fresh_scan, desc: `Letzter Scan ist aktuell (nicht älter als ${Number(cfg.scan_interval_minutes || 15) * 2} Min)` },
    { key: 'tradeable_target_reached', ok: readiness.tradeable_count >= readiness.min_tradeable_target, desc: `Mindestens ${readiness.min_tradeable_target} tradeable Märkte gefunden (aktuell: ${readiness.tradeable_count})` },
    { key: 'breaker_closed', ok: readiness.breaker_closed, desc: 'Circuit Breaker ist geschlossen (Scanner nicht pausiert)' }
  ];
  return { ok: checks.every((c) => c.ok), passed: checks.filter((c) => c.ok).length, total: checks.length, checks, readiness };
}

export function computeStepStatus(state = loadState()) {
  const cfg = state.config || {};
  const selfTest = runStep1SelfTest(state);
  const readiness = computeStep1Readiness(state);
  const toPct = (checks) => Number(((checks.filter((c) => c.ok).length / checks.length) * 100).toFixed(1));

  const briefs = state.research_briefs || [];
  const predictions = state.predictions || [];
  const brierSamples = (state.prediction_outcomes || []).length;
  const brierScore = state.brier_score;
  const trades = state.trades || [];
  const openTrades = trades.filter(t => t.status === 'OPEN');
  const closedTrades = trades.filter(t => t.status !== 'OPEN');

  const step1Checks = [
    // Include ALL self-test sub-checks directly
    ...selfTest.checks,
    { key: 'scan_runs_exist', ok: (state.scan_runs || []).length > 0, desc: 'Mindestens ein Scan wurde durchgeführt' },
  ];
  // Deduplicate by key
  const seen = new Set();
  const step1Deduped = step1Checks.filter(c => { if (seen.has(c.key)) return false; seen.add(c.key); return true; });
  const step2Checks = [
    { key: 'research_runs_exist', ok: (state.research_runs || []).length > 0, desc: 'Mindestens ein Research-Lauf durchgeführt' },
    { key: 'briefs_present', ok: briefs.length > 0, desc: `Research Briefs vorhanden (aktuell: ${briefs.length})` },
    { key: 'coverage_present', ok: Number(state.research_summary?.coverage_pct || 0) > 0, desc: `Coverage > 0% (aktuell: ${Number(state.research_summary?.coverage_pct || 0).toFixed(1)}%)` },
    { key: 'source_diversity', ok: Number(state.research_summary?.source_diversity || 0) >= 1, desc: `Mind. 1 Nachrichtenquelle liefert Daten (aktuell: ${state.research_summary?.source_diversity || 0} Quellen)` },
    { key: 'avg_confidence', ok: Number(state.research_summary?.avg_confidence || 0) >= 0.3, desc: `Durchschnittliche Confidence ≥ 0.3 (aktuell: ${Number(state.research_summary?.avg_confidence || 0).toFixed(3)})` },
  ];
  const step3Checks = [
    { key: 'predict_runs_exist', ok: (state.predict_runs || []).length > 0, desc: 'Mindestens ein Predict-Lauf durchgeführt' },
    { key: 'predictions_present', ok: predictions.length > 0, desc: `Predictions vorhanden (aktuell: ${predictions.length})` },
    { key: 'actionable_exist', ok: predictions.some(p => p.actionable), desc: 'Mindestens eine actionable Prediction (BUY_YES oder BUY_NO)' },
    { key: 'brier_tracking', ok: brierSamples >= 1, desc: `Brier Score wird getrackt (${brierSamples} Outcomes erfasst${brierScore != null ? `, Score: ${Number(brierScore).toFixed(4)}` : ''})` },
  ];
  const step4Checks = [
    { key: 'execution_runs_exist', ok: (state.execution_runs || []).length > 0, desc: 'Mindestens ein Execute-Lauf durchgeführt' },
    { key: 'paper_mode_set', ok: typeof state.step4_summary?.paper_mode === 'boolean', desc: 'Paper/Live Modus definiert' },
    { key: 'kelly_configured', ok: Number(cfg.kelly_fraction || 0) > 0 && Number(cfg.kelly_fraction || 0) <= 1, desc: `Kelly Fraction konfiguriert (aktuell: ${cfg.kelly_fraction || '?'})` },
    { key: 'no_correlation_conflicts', ok: Number(state.step4_summary?.correlation_blocked || 0) === 0 || !state.step4_summary, desc: `Keine korrelierten Trades blockiert (${state.step4_summary?.correlation_blocked || 0} geblockt)` },
  ];
  const step5Checks = [
    { key: 'risk_runs_exist', ok: (state.risk_runs || []).length > 0, desc: 'Mindestens ein Risk-Check durchgeführt' },
    { key: 'risk_limits_set', ok: Number(cfg.max_pos_pct || 0) > 0 && Number(cfg.max_drawdown_pct || 0) > 0, desc: 'Risk-Limits konfiguriert (max_pos_pct + max_drawdown)' },
    { key: 'drawdown_ok', ok: Number(state.risk?.drawdown_pct || 0) < Number(cfg.max_drawdown_pct || 0.08), desc: `Drawdown unter Limit (${(Number(state.risk?.drawdown_pct || 0) * 100).toFixed(1)}% < ${(Number(cfg.max_drawdown_pct || 0.08) * 100).toFixed(0)}%)` },
    { key: 'compound_exists', ok: Boolean(state.compound_summary?.updated_at), desc: 'Compound/Learning Step wurde ausgeführt (Bot lernt aus Trades)' },
  ];
  return {
    step1: { progress_pct: toPct(step1Deduped), checks: step1Deduped, readiness },
    step2: { progress_pct: toPct(step2Checks), checks: step2Checks },
    step3: { progress_pct: toPct(step3Checks), checks: step3Checks },
    step4: { progress_pct: toPct(step4Checks), checks: step4Checks },
    step5: { progress_pct: toPct(step5Checks), checks: step5Checks }
  };
}

export function buildHeuristicScanRecommendation(state = loadState()) {
  const s = state.research_summary || {};
  const avgConfidence = Number(s.avg_confidence || 0);
  const coveragePct = Number(s.coverage_pct || 0);
  const sourceDiversity = Number(s.source_diversity || 0);
  const top = (state.scan_results || []).slice(0, Number(state.config?.top_n || 10));
  const avgSpread = top.length ? top.reduce((sum, m) => sum + Number(m.spread || 0), 0) / top.length : 0;
  const avgSlippage = top.length ? top.reduce((sum, m) => sum + Number(m.estimated_slippage || 0), 0) / top.length : 0;
  const tightMode = avgConfidence >= 0.58 && coveragePct >= 60 && sourceDiversity >= 3;
  const liquidityStress = avgSpread > 0.035 || avgSlippage > 0.02;
  return {
    scanner_min_volume: tightMode ? 80000 : liquidityStress ? 60000 : 30000,
    scanner_min_liquidity: tightMode ? 20000 : liquidityStress ? 15000 : 8000,
    scanner_max_slippage_pct: tightMode ? 0.015 : liquidityStress ? 0.018 : 0.025,
    scanner_min_anomaly_score: tightMode ? 1.3 : liquidityStress ? 1.1 : 0.9,
    scan_interval_minutes: tightMode ? 15 : 20,
    top_n: tightMode ? 15 : liquidityStress ? 8 : 10
  };
}

export function buildImprovementReport(state = loadState()) {
  const stepStatus = computeStepStatus(state);
  const report = [];
  if (Number(stepStatus.step1?.progress_pct || 0) < 100) report.push({ area: 'Step 1 Scan', severity: 'high', recommendation: 'Scanner-Filter prüfen, Scan laufen lassen.' });
  if (Number(stepStatus.step2?.progress_pct || 0) < 100) report.push({ area: 'Step 2 Research', severity: 'high', recommendation: 'Mehr Quellen aktivieren.' });
  if (Number(stepStatus.step3?.progress_pct || 0) < 100) report.push({ area: 'Step 3 Predict', severity: 'medium', recommendation: 'Predict-Step ausführen.' });
  if (Number(stepStatus.step4?.progress_pct || 0) < 100) report.push({ area: 'Step 4 Execute', severity: 'medium', recommendation: 'Execute-Step ausführen.' });
  if (Number(stepStatus.step5?.progress_pct || 0) < 100) report.push({ area: 'Step 5 Risk', severity: 'low', recommendation: 'Risk-Limits setzen.' });
  return { improvements: report, step_status: stepStatus };
}
