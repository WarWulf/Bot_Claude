// riskEngine.js — Full risk validation: drawdown, daily loss, exposure, position limits, VaR

import { loadState, saveState } from './appState.js';

export async function runRiskStep(state = loadState()) {
  const cfg = state.config || {};
  const trades = (state.trades || []).filter(t => t.status === 'OPEN');
  const closedTrades = (state.trades || []).filter(t => t.status !== 'OPEN');
  const bankroll = Number(cfg.bankroll || 0);

  // Calculate real P&L
  const totalPnl = closedTrades.reduce((s, t) => s + Number(t.netPnlUsd || 0), 0);
  const currentEquity = bankroll + totalPnl;

  // Track peak bankroll for drawdown
  state.risk = state.risk || {};
  const peakBankroll = Math.max(Number(state.risk.peak_bankroll || bankroll), currentEquity);
  state.risk.peak_bankroll = peakBankroll;

  // Drawdown calculation
  const drawdownPct = peakBankroll > 0 ? (peakBankroll - currentEquity) / peakBankroll : 0;
  state.risk.drawdown_pct = Number(drawdownPct.toFixed(4));

  // Daily P&L tracking
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = closedTrades.filter(t => (t.time || '').startsWith(today));
  const dailyPnl = todayTrades.reduce((s, t) => s + Number(t.netPnlUsd || 0), 0);
  state.risk.daily_realized_pnl = Number(dailyPnl.toFixed(2));

  // Exposure
  const totalExposureUsd = trades.reduce((s, t) => s + Number(t.positionUsd || 0), 0);
  const exposurePct = bankroll > 0 ? totalExposureUsd / bankroll : 0;
  state.risk.open_exposure_usd = Number(totalExposureUsd.toFixed(2));
  state.risk.open_positions = trades.length;

  // Run all risk checks
  const maxPosPct = Number(cfg.max_pos_pct || 0.05);
  const maxExposurePct = Number(cfg.max_total_exposure_pct || 0.5);
  const maxDrawdownPct = Number(cfg.max_drawdown_pct || 0.08);
  const dailyLossLimit = Number(cfg.daily_loss_limit_pct || 0.15);
  const maxPositions = Number(cfg.max_concurrent_positions || 15);

  const checks = [
    { check: 'position_size', ok: trades.every(t => bankroll > 0 ? (Number(t.positionUsd||0)/bankroll) <= maxPosPct : true),
      desc: `Keine Position > ${(maxPosPct*100).toFixed(0)}% des Bankrolls`, violations: trades.filter(t => bankroll>0 && (Number(t.positionUsd||0)/bankroll) > maxPosPct).map(t=>t.market_id) },
    { check: 'total_exposure', ok: exposurePct <= maxExposurePct,
      desc: `Gesamt-Exposure ${(exposurePct*100).toFixed(1)}% ≤ ${(maxExposurePct*100).toFixed(0)}%`, value: exposurePct },
    { check: 'drawdown', ok: drawdownPct < maxDrawdownPct,
      desc: `Drawdown ${(drawdownPct*100).toFixed(1)}% < ${(maxDrawdownPct*100).toFixed(0)}%`, value: drawdownPct,
      action: drawdownPct >= maxDrawdownPct ? 'BLOCK_ALL_NEW_TRADES' : drawdownPct >= 0.05 ? 'REDUCE_TO_EIGHTH_KELLY' : 'OK' },
    { check: 'daily_loss', ok: bankroll > 0 ? (Math.abs(Math.min(0, dailyPnl)) / bankroll) < dailyLossLimit : true,
      desc: `Tagesverlust $${Math.abs(Math.min(0, dailyPnl)).toFixed(0)} < ${(dailyLossLimit*100).toFixed(0)}% Limit`, value: dailyPnl },
    { check: 'max_positions', ok: trades.length <= maxPositions,
      desc: `${trades.length} Positionen ≤ ${maxPositions} max`, value: trades.length },
  ];

  // Determine risk level
  const allOk = checks.every(c => c.ok);
  const drawdownAction = checks.find(c => c.check === 'drawdown')?.action || 'OK';
  state.risk.level = drawdownAction === 'BLOCK_ALL_NEW_TRADES' ? 'CRITICAL' : drawdownAction === 'REDUCE_TO_EIGHTH_KELLY' ? 'WARNING' : allOk ? 'OK' : 'ELEVATED';
  state.risk.total_exposure_pct = Number(exposurePct.toFixed(4));

  state.step5_summary = {
    completed_at: new Date().toISOString(),
    checked_positions: trades.length,
    violations: checks.filter(c => !c.ok).length,
    checks: checks,
    risk_level: state.risk.level,
    drawdown_pct: state.risk.drawdown_pct,
    daily_pnl: state.risk.daily_realized_pnl,
    total_exposure_pct: state.risk.total_exposure_pct,
    current_equity: Number(currentEquity.toFixed(2)),
    peak_bankroll: peakBankroll,
  };

  state.risk_runs = state.risk_runs || [];
  state.risk_runs.unshift({ time: new Date().toISOString(), summary: state.step5_summary });
  state.risk_runs = state.risk_runs.slice(0, 100);
  saveState(state);
  return { summary: state.step5_summary, checks, runs: state.risk_runs };
}
