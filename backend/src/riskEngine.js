// riskEngine.js — Risk validation step

import { loadState, saveState } from './appState.js';

export async function runRiskStep(state = loadState()) {
  const trades = (state.trades || []).filter((t) => t.status === 'OPEN').slice(0, 100);
  const bankroll = Number(state.config?.bankroll || 0);
  const maxPosPct = Number(state.config?.max_pos_pct || 0.05);
  const totalExposureUsd = trades.reduce((sum, t) => sum + Number(t.positionUsd || 0), 0);
  const violations = trades.filter((t) => bankroll > 0 && (Number(t.positionUsd || 0) / bankroll) > maxPosPct);
  state.risk = state.risk || {};
  state.step5_summary = { completed_at: new Date().toISOString(), checked_positions: trades.length, violations: violations.length, max_position_pct: maxPosPct, total_exposure_pct: bankroll > 0 ? Number((totalExposureUsd / bankroll).toFixed(4)) : 0 };
  state.risk.last_risk_checks = violations.map((t) => ({ market_id: t.market_id, issue: 'position_exceeds_max_pos_pct' })).slice(0, 100);
  state.risk_runs = state.risk_runs || [];
  state.risk_runs.unshift({ time: new Date().toISOString(), summary: state.step5_summary });
  state.risk_runs = state.risk_runs.slice(0, 100);
  saveState(state);
  return { summary: state.step5_summary, violations: state.risk.last_risk_checks, runs: state.risk_runs };
}
