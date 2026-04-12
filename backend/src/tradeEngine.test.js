import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenPaperPosition, computePaperPositionUsd } from './tradeEngine.js';

test('computePaperPositionUsd stays within max_pos_pct cap', () => {
  const usd = computePaperPositionUsd(
    { confidence: 0.9, edge: 0.2 },
    { bankroll: 1000, paper_trade_risk_pct: 0.03, max_pos_pct: 0.04 }
  );
  assert.equal(usd, 40);
});

test('computePaperPositionUsd returns zero with missing bankroll', () => {
  assert.equal(computePaperPositionUsd({ confidence: 0.8, edge: 0.1 }, { bankroll: 0 }), 0);
});

test('canOpenPaperPosition blocks when exposure would exceed max_total_exposure_pct', () => {
  const out = canOpenPaperPosition({
    openExposureUsd: 480,
    newPositionUsd: 40,
    cfg: { bankroll: 1000, max_total_exposure_pct: 0.5 }
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'max_total_exposure_exceeded');
});

test('canOpenPaperPosition allows trade inside exposure budget', () => {
  const out = canOpenPaperPosition({
    openExposureUsd: 200,
    newPositionUsd: 40,
    cfg: { bankroll: 1000, max_total_exposure_pct: 0.5 }
  });
  assert.equal(out.ok, true);
});
