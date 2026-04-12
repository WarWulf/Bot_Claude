// execution.js — Order execution with correlation checks and duplicate prevention

import { loadState, saveState, nextId } from './appState.js';
import { canOpenPaperPosition, computePaperPositionUsd } from './tradeEngine.js';
import { detectCorrelatedGroups } from './correlatedMarkets.js';

export async function runExecutionStep(state = loadState()) {
  const predictions = (state.predictions || []).slice(0, Number(state.config?.top_n || 10));
  const actionable = predictions.filter((p) => p.actionable && p.direction && p.direction !== 'NO_TRADE');
  let executed = 0, skipped = 0, openedTrades = 0, riskBlocked = 0, correlationBlocked = 0, duplicateBlocked = 0;
  state.orders = state.orders || [];
  state.trades = state.trades || [];
  const openTrades = (state.trades || []).filter((t) => t.status === 'OPEN');
  let openExposureUsd = openTrades.reduce((sum, t) => sum + Number(t.positionUsd || 0), 0);

  // Build set of already-open market IDs to prevent duplicates
  const openMarketIds = new Set(openTrades.map(t => String(t.market_id)));

  // Detect correlated groups (e.g. multiple presidential candidates)
  const { conflicts } = detectCorrelatedGroups(actionable);
  const blockedByCorrelation = new Set();
  for (const conflict of conflicts) {
    // Keep only the one with highest edge, block the rest
    const sorted = (conflict.members || []).sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    sorted.slice(1).forEach(m => blockedByCorrelation.add(String(m.market_id)));
  }

  for (const p of actionable) {
    if (state.config?.kill_switch) { skipped += 1; continue; }

    // Check: already have an open trade on this market?
    if (openMarketIds.has(String(p.market_id))) { skipped += 1; duplicateBlocked += 1; continue; }

    // Check: blocked by correlation (mutually exclusive markets)?
    if (blockedByCorrelation.has(String(p.market_id))) { skipped += 1; correlationBlocked += 1; continue; }

    const positionUsd = computePaperPositionUsd(p, state.config || {});
    const exposureCheck = canOpenPaperPosition({ openExposureUsd, newPositionUsd: positionUsd, cfg: state.config || {} });
    if (!exposureCheck.ok) { skipped += 1; riskBlocked += 1; continue; }

    // Check: max concurrent positions
    if (openTrades.length + openedTrades >= Number(state.config?.max_concurrent_positions || 15)) { skipped += 1; riskBlocked += 1; continue; }

    const order = { id: nextId(state.orders), time: new Date().toISOString(), market_id: p.market_id, question: p.question, direction: p.direction, confidence: Number(p.confidence || 0), edge: Number(p.edge || 0), positionUsd, status: state.config?.paper_mode ? 'PAPER_EXECUTED' : 'READY_TO_ROUTE' };
    state.orders.unshift(order);
    executed += 1;
    if (state.config?.paper_mode) {
      state.trades.unshift({ id: nextId(state.trades), order_id: order.id, time: order.time, market_id: p.market_id, title: p.question, source: p.platform || p.source || 'unknown', direction: p.direction, status: 'OPEN', positionUsd, netPnlUsd: 0 });
      openedTrades += 1;
      openExposureUsd += positionUsd;
      openMarketIds.add(String(p.market_id));
    }
  }
  state.orders = state.orders.slice(0, 1000);
  state.trades = state.trades.slice(0, 2000);
  state.step4_summary = {
    completed_at: new Date().toISOString(), candidate_signals: actionable.length,
    executed_orders: executed, skipped_orders: skipped, opened_trades: openedTrades,
    risk_blocked_orders: riskBlocked, correlation_blocked: correlationBlocked,
    duplicate_blocked: duplicateBlocked, correlation_conflicts: conflicts.length,
    total_open_exposure_usd: Number(openExposureUsd.toFixed(2)),
    paper_mode: Boolean(state.config?.paper_mode)
  };
  state.execution_runs = state.execution_runs || [];
  state.execution_runs.unshift({ time: new Date().toISOString(), summary: state.step4_summary });
  state.execution_runs = state.execution_runs.slice(0, 100);
  saveState(state);
  return { summary: state.step4_summary, orders: state.orders.slice(0, 50), runs: state.execution_runs };
}
