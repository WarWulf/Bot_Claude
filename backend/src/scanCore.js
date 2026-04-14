export function calcSevenDayVolumeAvg(history) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const filtered = (history || []).filter((x) => new Date(x.t).getTime() >= sevenDaysAgo);
  if (!filtered.length) return 0;
  return filtered.reduce((sum, item) => sum + Number(item.v || 0), 0) / filtered.length;
}

export function estimateSlippage(market) {
  const bid = Number(market.bid ?? market.market_price ?? 0.5);
  const ask = Number(market.ask ?? market.market_price ?? 0.5);
  const mid = (bid + ask) / 2;
  if (mid <= 0) return 0;
  const raw = Math.abs(ask - bid) / mid;
  // If bid and ask are the same (no orderbook data), assume 0 slippage
  return Number.isFinite(raw) ? raw : 0;
}

export function isWithinActiveHours(cfg) {
  const from = Number(cfg.scanner_active_from_utc ?? 0);  // Default: 24/7
  const to = Number(cfg.scanner_active_to_utc ?? 24);      // Default: 24/7
  if (from === 0 && to === 24) return true; // 24/7 mode
  if (from === to) return true;
  const hour = new Date().getUTCHours();
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}
