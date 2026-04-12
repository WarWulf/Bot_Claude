export function computePaperPositionUsd(prediction = {}, cfg = {}) {
  const bankroll = Math.max(0, Number(cfg.bankroll || 0));
  if (!bankroll) return 0;
  const baseRiskPct = Math.max(0, Math.min(1, Number(cfg.paper_trade_risk_pct ?? 0.02)));
  const maxPosPct = Math.max(0, Math.min(1, Number(cfg.max_pos_pct ?? 0.05)));
  const confidence = Math.max(0, Math.min(1, Number(prediction.confidence || 0)));
  const edge = Math.abs(Number(prediction.edge || 0));
  const confidenceBoost = 0.5 + (0.5 * confidence);
  const edgeBoost = Math.max(0.4, Math.min(1.6, edge / 0.05));
  const targetPct = baseRiskPct * confidenceBoost * edgeBoost;
  const finalPct = Math.max(0, Math.min(maxPosPct, targetPct));
  return Number((bankroll * finalPct).toFixed(2));
}

export function canOpenPaperPosition({ openExposureUsd = 0, newPositionUsd = 0, cfg = {} } = {}) {
  const bankroll = Math.max(0, Number(cfg.bankroll || 0));
  if (!bankroll) return { ok: false, reason: 'bankroll_not_configured' };
  const maxTotalExposurePct = Math.max(0, Math.min(1, Number(cfg.max_total_exposure_pct ?? 0.5)));
  const maxExposureUsd = bankroll * maxTotalExposurePct;
  if ((Number(openExposureUsd) + Number(newPositionUsd)) > maxExposureUsd) {
    return { ok: false, reason: 'max_total_exposure_exceeded' };
  }
  return { ok: true, reason: '' };
}
