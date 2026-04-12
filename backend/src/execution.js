// execution.js — Order execution and paper trading

import { loadState, saveState, nextId } from './appState.js';
import { canOpenPaperPosition, computePaperPositionUsd } from './tradeEngine.js';

export async function runExecutionStep(state = loadState()) {
  const predictions = (state.predictions || []).slice(0, Number(state.config?.top_n || 10));
  const actionable = predictions.filter((p) => p.actionable && p.direction && p.direction !== 'NO_TRADE');
  let executed = 0, skipped = 0, openedTrades = 0, riskBlocked = 0;
  state.orders = state.orders || [];
  state.trades = state.trades || [];
  let openExposureUsd = (state.trades || []).filter((t) => t.status === 'OPEN').reduce((sum, t) => sum + Number(t.positionUsd || 0), 0);

  for (const p of actionable) {
    if (state.config?.kill_switch) { skipped += 1; continue; }
    const positionUsd = computePaperPositionUsd(p, state.config || {});
    const exposureCheck = canOpenPaperPosition({ openExposureUsd, newPositionUsd: positionUsd, cfg: state.config || {} });
    if (!exposureCheck.ok) { skipped += 1; riskBlocked += 1; continue; }
    const order = { id: nextId(state.orders), time: new Date().toISOString(), market_id: p.market_id, question: p.question, direction: p.direction, confidence: Number(p.confidence || 0), edge: Number(p.edge || 0), positionUsd, status: state.config?.paper_mode ? 'PAPER_EXECUTED' : 'READY_TO_ROUTE' };
    state.orders.unshift(order);
    executed += 1;
    if (state.config?.paper_mode) {
      state.trades.unshift({ id: nextId(state.trades), order_id: order.id, time: order.time, market_id: p.market_id, title: p.question, source: p.platform || p.source || 'unknown', direction: p.direction, status: 'OPEN', positionUsd, netPnlUsd: 0 });
      openedTrades += 1;
      openExposureUsd += positionUsd;
    }
  }
  state.orders = state.orders.slice(0, 1000);
  state.trades = state.trades.slice(0, 2000);
  state.step4_summary = { completed_at: new Date().toISOString(), candidate_signals: actionable.length, executed_orders: executed, skipped_orders: skipped, opened_trades: openedTrades, risk_blocked_orders: riskBlocked, total_open_exposure_usd: Number(openExposureUsd.toFixed(2)), paper_mode: Boolean(state.config?.paper_mode) };
  state.execution_runs = state.execution_runs || [];
  state.execution_runs.unshift({ time: new Date().toISOString(), summary: state.step4_summary });
  state.execution_runs = state.execution_runs.slice(0, 100);
  saveState(state);
  return { summary: state.step4_summary, orders: state.orders.slice(0, 50), runs: state.execution_runs };
}
