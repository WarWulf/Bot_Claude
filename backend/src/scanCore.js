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
  return Math.abs(ask - bid) / mid;
}

export function isWithinActiveHours(cfg) {
  const from = Number(cfg.scanner_active_from_utc ?? 6);
  const to = Number(cfg.scanner_active_to_utc ?? 23);
  const hour = new Date().getUTCHours();
  if (from === to) return true;
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}
