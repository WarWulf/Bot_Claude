import test from 'node:test';
import assert from 'node:assert/strict';
import { calcSevenDayVolumeAvg, estimateSlippage } from './scanCore.js';

test('calcSevenDayVolumeAvg computes mean on recent points', () => {
  const now = Date.now();
  const points = [
    { t: new Date(now - 1000).toISOString(), v: 100 },
    { t: new Date(now - 2000).toISOString(), v: 300 }
  ];
  assert.equal(calcSevenDayVolumeAvg(points), 200);
});

test('estimateSlippage returns spread over mid', () => {
  const s = estimateSlippage({ bid: 0.49, ask: 0.51 });
  assert.ok(s > 0.039 && s < 0.041);
});

test('calcSevenDayVolumeAvg ignores stale points older than seven days', () => {
  const now = Date.now();
  const points = [
    { t: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), v: 120 },
    { t: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(), v: 1000 }
  ];
  assert.equal(calcSevenDayVolumeAvg(points), 120);
});

test('estimateSlippage returns zero when midpoint is zero', () => {
  assert.equal(estimateSlippage({ bid: 0, ask: 0 }), 0);
});
