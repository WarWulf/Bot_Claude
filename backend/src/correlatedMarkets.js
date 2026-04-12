// correlatedMarkets.js — Detect mutually exclusive market groups

const EXCLUSION_PATTERNS = [
  /will\s+(.+?)\s+win\s+(?:the\s+)?(\d{4})\s+(.+?)\s*(?:election|race|championship|cup|title)/i,
  /who\s+will\s+win\s+(?:the\s+)?(.+?)\s*(?:\d{4})?\s*(?:election|championship|cup|title|race)/i,
  /(.+?)\s+(?:to\s+)?win\s+(?:the\s+)?(\d{4})?\s*(.+?)(?:\?|$)/i,
];

function extractGroupKey(question) {
  const q = String(question || '').trim();
  for (const pattern of EXCLUSION_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const parts = m.slice(1).filter(Boolean).map(s => s.trim().toLowerCase());
      const year = parts.find(p => /^\d{4}$/.test(p)) || '';
      const event = parts.filter(p => !/^\d{4}$/.test(p) && p.length > 3).join(' ');
      if (event.length > 5) return `${event}${year ? '_' + year : ''}`;
    }
  }
  return null;
}

export function detectCorrelatedGroups(predictions) {
  const groups = {};
  for (const p of predictions) {
    const key = extractGroupKey(p.question || '');
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ market_id: p.market_id, question: p.question, direction: p.direction, edge: p.edge, model_prob: p.model_prob });
  }
  const conflicts = [];
  for (const [key, members] of Object.entries(groups)) {
    if (members.length < 2) continue;
    const allBuyYes = members.filter(m => m.direction === 'BUY_YES');
    if (allBuyYes.length > 1) {
      const totalProb = allBuyYes.reduce((s, m) => s + Number(m.model_prob || 0), 0);
      conflicts.push({
        group: key, issue: 'mutually_exclusive_buy_yes', members: allBuyYes,
        total_implied_prob: Number(totalProb.toFixed(4)),
        message: `${allBuyYes.length} BUY_YES in "${key}" — nur ein Gewinner möglich. Summe ${(totalProb * 100).toFixed(1)}% ist logisch unmöglich.`,
        recommendation: allBuyYes.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0]?.question?.slice(0, 60) || '',
      });
    }
  }
  return { groups: Object.keys(groups).length, conflicts };
}
