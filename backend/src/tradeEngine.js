// tradeEngine.js — Kelly Criterion position sizing + exposure checks
//
// Was ist Kelly Criterion?
// Eine Formel die berechnet wie viel du bei einem Vorteil setzen sollst.
// Full Kelly = maximales Wachstum, aber sehr volatil.
// Quarter Kelly (0.25) = sicherer, konsistentere Ergebnisse.
//
// Formel: f* = (p * b - q) / b
//   p = Gewinnwahrscheinlichkeit (dein Model)
//   q = 1 - p (Verlustwahrscheinlichkeit)
//   b = Netto-Odds = (1 / market_price) - 1

export function kellyFraction(probability, marketPrice) {
  const p = Math.max(0.01, Math.min(0.99, Number(probability)));
  const q = 1.0 - p;
  const b = marketPrice > 0 && marketPrice < 1 ? (1.0 / marketPrice) - 1.0 : 1.0;
  if (b <= 0) return 0;
  const fullKelly = (p * b - q) / b;
  return Math.max(0, fullKelly);
}

export function computePaperPositionUsd(prediction = {}, cfg = {}) {
  const bankroll = Math.max(0, Number(cfg.bankroll || 0));
  if (!bankroll) return 0;

  const maxPosPct = Math.max(0, Math.min(1, Number(cfg.max_pos_pct ?? 0.05)));
  const kellyMult = Math.max(0.1, Math.min(1, Number(cfg.kelly_fraction ?? 0.25)));
  const modelProb = Math.max(0.01, Math.min(0.99, Number(prediction.model_prob || prediction.confidence || 0.5)));
  const marketPrice = Math.max(0.01, Math.min(0.99, Number(prediction.market_prob || 0.5)));

  // Kelly Criterion
  const fullKelly = kellyFraction(modelProb, marketPrice);
  const fractionalKelly = fullKelly * kellyMult;

  // Clamp to max position size
  const positionPct = Math.min(fractionalKelly, maxPosPct);
  const positionUsd = Number((bankroll * positionPct).toFixed(2));

  // Minimum $1 or skip
  return positionUsd >= 1 ? positionUsd : 0;
}

export function canOpenPaperPosition({ openExposureUsd = 0, newPositionUsd = 0, cfg = {} } = {}) {
  const bankroll = Math.max(0, Number(cfg.bankroll || 0));
  if (!bankroll) return { ok: false, reason: 'bankroll_not_configured' };

  const maxTotalExposurePct = Math.max(0, Math.min(1, Number(cfg.max_total_exposure_pct ?? 0.5)));
  const maxExposureUsd = bankroll * maxTotalExposurePct;

  if ((Number(openExposureUsd) + Number(newPositionUsd)) > maxExposureUsd) {
    return { ok: false, reason: 'max_total_exposure_exceeded' };
  }

  // Daily loss check
  const dailyLoss = Math.abs(Number(cfg._daily_realized_loss || 0));
  const dailyLimit = bankroll * Number(cfg.daily_loss_limit_pct || 0.15);
  if (dailyLoss >= dailyLimit) {
    return { ok: false, reason: 'daily_loss_limit_reached' };
  }

  return { ok: true, reason: '' };
}
