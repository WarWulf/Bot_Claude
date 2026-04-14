// tradeEngine.js — Kelly Criterion position sizing + exposure checks
//
// Was ist Kelly Criterion?
// Eine Formel die berechnet wie viel du bei einem Vorteil setzen sollst.
// Full Kelly = maximales Wachstum, aber sehr volatil.
// Quarter Kelly (0.25) = sicherer, konsistentere Ergebnisse.
//
// Formel: f* = (p * b - q) / b
//   p = Gewinnwahrscheinlichkeit
//   q = 1 - p (Verlustwahrscheinlichkeit)
//   b = Netto-Odds = (1 / contract_price) - 1
//
// WICHTIG: Bei BUY_NO muss aus der NO-Perspektive gerechnet werden!
//   BUY_YES: p = model_prob,     contract_price = market_price
//   BUY_NO:  p = 1 - model_prob, contract_price = 1 - market_price

export function kellyFraction(winProb, contractPrice) {
  const p = Math.max(0.01, Math.min(0.99, Number(winProb)));
  const q = 1.0 - p;
  const b = contractPrice > 0 && contractPrice < 1 ? (1.0 / contractPrice) - 1.0 : 1.0;
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
  const direction = String(prediction.direction || '').toUpperCase();

  // Kelly Criterion — depends on direction!
  let fullKelly;
  if (direction === 'BUY_NO') {
    // BUY_NO: we're betting that the event WON'T happen
    // Our win probability = 1 - model_prob (chance NO wins)
    // Contract price = 1 - market_price (price of NO contract)
    const noWinProb = 1 - modelProb;
    const noContractPrice = 1 - marketPrice;
    fullKelly = kellyFraction(noWinProb, noContractPrice);
  } else {
    // BUY_YES: we're betting that the event WILL happen
    fullKelly = kellyFraction(modelProb, marketPrice);
  }

  const fractionalKelly = fullKelly * kellyMult;

  // Clamp to max position size
  const positionPct = Math.min(fractionalKelly, maxPosPct);

  // Minimum $1 position, otherwise skip
  const positionUsd = Number((bankroll * positionPct).toFixed(2));
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
