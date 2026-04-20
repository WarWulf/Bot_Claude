// learningEngine.js — Self-Learning System
// Lernt aus: Trades, Marktbewegungen, Quellen-Qualität, Predictions vs Outcomes
// Funktioniert für: Prediction Markets UND Forex

import { loadState, saveState, logLine } from './appState.js';
import { pushLiveComm } from './utils.js';

// ═══════════════════════════════════════════
// 1. MARKET OBSERVER — lernt auch OHNE zu traden
// ═══════════════════════════════════════════

export function observeMarketOutcomes(state) {
  const predictions = state.predictions || [];
  const outcomes = state.prediction_outcomes || [];
  const existingIds = new Set(outcomes.map(o => o.prediction_id || o.market_id));
  let newObservations = 0;

  for (const pred of predictions) {
    if (existingIds.has(pred.market_id)) continue;

    // Find if market has resolved (scan_results no longer contains it OR price moved to 0/1)
    const currentMarket = (state.scan_results || []).find(m => m.id === pred.market_id || m.market === pred.market_id);
    const allMarkets = (state.markets || []).find(m => m.id === pred.market_id);

    if (!currentMarket && allMarkets) {
      // Market disappeared from scan = probably resolved
      const finalPrice = Number(allMarkets.market_price || 0.5);
      const resolved = finalPrice >= 0.95 || finalPrice <= 0.05;
      if (resolved) {
        const actualOutcome = finalPrice >= 0.95 ? 1 : 0;
        outcomes.push({
          prediction_id: pred.market_id,
          market_id: pred.market_id,
          question: pred.question,
          predicted_prob: pred.model_prob,
          market_prob_at_prediction: pred.market_prob,
          actual_outcome: actualOutcome,
          edge: pred.edge,
          direction: pred.direction,
          was_traded: (state.trades || []).some(t => t.market_id === pred.market_id),
          observed_at: new Date().toISOString(),
          // Was the prediction correct?
          prediction_correct: pred.direction === 'BUY_YES' ? actualOutcome === 1 : pred.direction === 'BUY_NO' ? actualOutcome === 0 : null,
          would_have_won: pred.direction !== 'NO_TRADE' && ((pred.direction === 'BUY_YES' && actualOutcome === 1) || (pred.direction === 'BUY_NO' && actualOutcome === 0)),
          // Learning: was the NO_TRADE decision correct?
          no_trade_was_right: pred.direction === 'NO_TRADE' ? true : null,
        });
        newObservations++;
      }
    }
  }

  state.prediction_outcomes = outcomes.slice(0, 500);
  if (newObservations > 0) {
    pushLiveComm('learning_observation', { new: newObservations, total: outcomes.length });
    logLine(state, 'info', `learning: ${newObservations} neue Markt-Outcomes beobachtet (gesamt: ${outcomes.length})`);
  }
  return newObservations;
}

// ═══════════════════════════════════════════
// 2. SOURCE CREDIBILITY SCORING — auto-ranking
// ═══════════════════════════════════════════

// Tier-based default credibility until enough data is collected
// Tier 1 (0.65): established financial wire services — generally high quality
// Tier 2 (0.55): mainstream news with business sections
// Tier 3 (0.50): neutral default for unknowns and social media
// Tier 4 (0.45): known low-quality or biased sources
const SOURCE_TIERS = {
  // Tier 1 — Financial wire services and specialist outlets
  'reuters.com': 0.65, 'bloomberg.com': 0.65, 'ft.com': 0.65,
  'wsj.com': 0.65, 'forexlive.com': 0.65, 'fxstreet.com': 0.65,
  'dailyfx.com': 0.65, 'investing.com': 0.62, 'cnbc.com': 0.60,
  'marketwatch.com': 0.60, 'barrons.com': 0.62,
  // Tier 2 — Mainstream news
  'bbc.co.uk': 0.57, 'bbc.com': 0.57, 'nytimes.com': 0.58,
  'theguardian.com': 0.55, 'apnews.com': 0.60, 'npr.org': 0.55,
  'washingtonpost.com': 0.56, 'economist.com': 0.60,
  // Tier 3 — Social media / aggregators (default neutral)
  'reddit.com': 0.50, 'twitter.com': 0.48, 'x.com': 0.48,
  'medium.com': 0.48, 'substack.com': 0.50,
  // GDELT (aggregator, mixed quality)
  'gdelt': 0.50,
};

export function getDefaultCredibility(domain) {
  if (!domain) return 0.5;
  const d = String(domain).toLowerCase().replace(/^www\./, '');
  if (SOURCE_TIERS[d] != null) return SOURCE_TIERS[d];
  // Partial matches
  for (const [key, val] of Object.entries(SOURCE_TIERS)) {
    if (d.includes(key) || key.includes(d)) return val;
  }
  return 0.5; // neutral for unknown sources
}

export function updateSourceCredibility(state) {
  const briefs = state.research_briefs || [];
  const outcomes = state.prediction_outcomes || [];
  if (outcomes.length < 5) return;

  state.source_scores = state.source_scores || {};

  for (const outcome of outcomes.slice(0, 50)) {
    const brief = briefs.find(b => b.market_id === outcome.market_id);
    if (!brief || !brief.sources) continue;

    for (const src of brief.sources) {
      const domain = src.domain || src.source_type || 'unknown';
      if (!state.source_scores[domain]) {
        state.source_scores[domain] = {
          correct: 0, wrong: 0, total: 0,
          credibility: getDefaultCredibility(domain),
          default_tier: getDefaultCredibility(domain),
          last_updated: null,
        };
      }
      const ss = state.source_scores[domain];
      if (ss.last_updated === outcome.observed_at) continue;

      ss.total++;
      if (outcome.prediction_correct) ss.correct++;
      else if (outcome.prediction_correct === false) ss.wrong++;

      // Blend learned score with default tier until enough data (20+ outcomes)
      if (ss.total < 20) {
        const learnedWeight = Math.min(1, ss.total / 20);
        const learnedScore = ss.total > 0 ? ss.correct / ss.total : 0.5;
        ss.credibility = Number((
          learnedWeight * learnedScore + (1 - learnedWeight) * (ss.default_tier || 0.5)
        ).toFixed(3));
      } else {
        ss.credibility = Number((ss.correct / ss.total).toFixed(3));
      }
      ss.last_updated = outcome.observed_at;
    }
  }

  // Source ranking now includes default-tier sources too
  const ranked = Object.entries(state.source_scores)
    .sort((a, b) => b[1].credibility - a[1].credibility)
    .map(([domain, s]) => ({
      domain, credibility: s.credibility, total: s.total,
      grade: s.credibility >= 0.65 ? 'A' : s.credibility >= 0.5 ? 'B' : s.credibility >= 0.35 ? 'C' : 'D',
      blended: s.total < 20,
    }));

  state.source_ranking = ranked;
  return ranked;
}

// ═══════════════════════════════════════════
// 3. PREDICTION ACCURACY TRACKER
// ═══════════════════════════════════════════

export function analyzePredictionAccuracy(state) {
  const outcomes = (state.prediction_outcomes || []).filter(o => o.prediction_correct !== null);
  if (outcomes.length < 3) return { ready: false, count: outcomes.length };

  const correct = outcomes.filter(o => o.prediction_correct).length;
  const traded = outcomes.filter(o => o.was_traded);
  const notTraded = outcomes.filter(o => !o.was_traded);
  const wouldHaveWon = notTraded.filter(o => o.would_have_won);

  // Accuracy by direction
  const byDir = {};
  for (const o of outcomes) {
    const d = o.direction || 'NO_TRADE';
    if (!byDir[d]) byDir[d] = { correct: 0, wrong: 0 };
    if (o.prediction_correct) byDir[d].correct++; else byDir[d].wrong++;
  }

  // Accuracy by edge bucket
  const byEdge = { 'small (4-8%)': { correct: 0, wrong: 0 }, 'medium (8-15%)': { correct: 0, wrong: 0 }, 'large (>15%)': { correct: 0, wrong: 0 } };
  for (const o of outcomes) {
    const absEdge = Math.abs(o.edge || 0);
    const bucket = absEdge < 0.08 ? 'small (4-8%)' : absEdge < 0.15 ? 'medium (8-15%)' : 'large (>15%)';
    if (o.prediction_correct) byEdge[bucket].correct++; else byEdge[bucket].wrong++;
  }

  const insights = [];
  const overallAcc = (correct / outcomes.length * 100).toFixed(0);
  insights.push(`Gesamt-Vorhersage-Genauigkeit: ${overallAcc}% (${correct}/${outcomes.length})`);

  if (wouldHaveWon.length > 2) {
    insights.push(`⚠ ${wouldHaveWon.length} Trades wurden NICHT gemacht, hätten aber GEWONNEN. Min Edge senken?`);
  }

  for (const [dir, data] of Object.entries(byDir)) {
    const acc = data.correct + data.wrong > 0 ? (data.correct / (data.correct + data.wrong) * 100).toFixed(0) : 0;
    if (Number(acc) < 45 && data.correct + data.wrong >= 3) insights.push(`❌ ${dir} Vorhersagen nur ${acc}% korrekt — Richtung meiden!`);
    if (Number(acc) > 60 && data.correct + data.wrong >= 3) insights.push(`✅ ${dir} Vorhersagen ${acc}% korrekt — weiter so!`);
  }

  for (const [bucket, data] of Object.entries(byEdge)) {
    const total = data.correct + data.wrong;
    if (total >= 3) {
      const acc = (data.correct / total * 100).toFixed(0);
      if (Number(acc) > 60) insights.push(`✅ ${bucket} Edge: ${acc}% korrekt — guter Sweet Spot`);
      if (Number(acc) < 40) insights.push(`❌ ${bucket} Edge: nur ${acc}% korrekt — zu aggressiv?`);
    }
  }

  return {
    ready: true,
    total_observations: outcomes.length,
    accuracy_pct: Number(overallAcc),
    traded_count: traded.length,
    not_traded_count: notTraded.length,
    missed_winners: wouldHaveWon.length,
    by_direction: byDir,
    by_edge: byEdge,
    insights,
    source_ranking: state.source_ranking || [],
  };
}

// ═══════════════════════════════════════════
// 4. FOREX MARKET OBSERVER — lernt auch ohne Trades
// ═══════════════════════════════════════════

export function observeForexSignalOutcomes(state) {
  state.forex_signal_log = state.forex_signal_log || [];

  // Check past signals that were NOT traded — were they right?
  const recentSignals = (state.forex_signals?.signals || []).filter(s => s.direction && s.direction !== 'WAIT' && !s.error);
  const now = Date.now();

  for (const sig of recentSignals) {
    // Don't re-observe
    if (state.forex_signal_log.some(l => l.symbol === sig.symbol && l.time === sig.time)) continue;

    state.forex_signal_log.push({
      symbol: sig.symbol,
      direction: sig.direction,
      confidence: sig.confidence,
      signal_strength: sig.signal_strength,
      avg_score: sig.avg_score,
      entry_price: sig.current_price,
      time: sig.time || new Date().toISOString(),
      // Will be resolved later
      exit_price: null,
      outcome: null,
      resolved: false,
    });
  }

  // Resolve old signals (check price after 5 minutes)
  let resolved = 0;
  for (const log of state.forex_signal_log) {
    if (log.resolved) continue;
    const logTime = new Date(log.time).getTime();
    if (now - logTime < 5 * 60 * 1000) continue; // Wait 5 min

    // Use latest forex data if available
    const latest = (state.forex_signals?.signals || []).find(s => s.symbol === log.symbol);
    if (latest && latest.current_price && !latest.error) {
      log.exit_price = latest.current_price;
      if (log.direction === 'CALL') log.outcome = latest.current_price > log.entry_price ? 'CORRECT' : 'WRONG';
      else log.outcome = latest.current_price < log.entry_price ? 'CORRECT' : 'WRONG';
      log.resolved = true;
      log.pips = Math.round((latest.current_price - log.entry_price) / (log.symbol?.includes('JPY') ? 0.01 : 0.0001));
      resolved++;
    }
  }

  // Cap log size
  state.forex_signal_log = state.forex_signal_log.slice(0, 500);

  return resolved;
}

export function analyzeForexSignalAccuracy(state) {
  const logs = (state.forex_signal_log || []).filter(l => l.resolved && l.outcome);
  if (logs.length < 5) return { ready: false, count: logs.length };

  const correct = logs.filter(l => l.outcome === 'CORRECT').length;
  const wrong = logs.filter(l => l.outcome === 'WRONG').length;

  // By strength
  const byStrength = {};
  for (const l of logs) {
    const s = l.signal_strength || 'UNKNOWN';
    if (!byStrength[s]) byStrength[s] = { correct: 0, wrong: 0 };
    if (l.outcome === 'CORRECT') byStrength[s].correct++; else byStrength[s].wrong++;
  }

  // By symbol
  const bySymbol = {};
  for (const l of logs) {
    if (!bySymbol[l.symbol]) bySymbol[l.symbol] = { correct: 0, wrong: 0 };
    if (l.outcome === 'CORRECT') bySymbol[l.symbol].correct++; else bySymbol[l.symbol].wrong++;
  }

  const insights = [];
  const acc = (correct / logs.length * 100).toFixed(0);
  insights.push(`Signal-Genauigkeit (ohne zu traden): ${acc}% (${correct}/${logs.length})`);

  for (const [str, data] of Object.entries(byStrength)) {
    const total = data.correct + data.wrong;
    if (total >= 3) {
      const a = (data.correct / total * 100).toFixed(0);
      insights.push(`${str}: ${a}% korrekt (${total} Signale) ${Number(a) >= 55 ? '✅' : '❌'}`);
    }
  }

  for (const [sym, data] of Object.entries(bySymbol)) {
    const total = data.correct + data.wrong;
    if (total >= 3) {
      const a = (data.correct / total * 100).toFixed(0);
      insights.push(`${sym}: ${a}% korrekt ${Number(a) >= 55 ? '✅' : Number(a) < 45 ? '❌ meiden!' : ''}`);
    }
  }

  return {
    ready: true,
    total_signals: logs.length,
    accuracy_pct: Number(acc),
    correct, wrong,
    by_strength: byStrength,
    by_symbol: bySymbol,
    insights,
  };
}

// ═══════════════════════════════════════════
// 5. BUILD COMPREHENSIVE LEARNING CONTEXT FOR LLM
// ═══════════════════════════════════════════

export function buildFullLearningContext(state, type = 'pm') {
  const lines = [];

  if (type === 'pm') {
    const accuracy = analyzePredictionAccuracy(state);
    if (accuracy.ready) {
      lines.push(`\n═══ LEARNING DATA (${accuracy.total_observations} beobachtete Outcomes) ═══`);
      for (const i of accuracy.insights.slice(0, 6)) lines.push(i);
      if (accuracy.missed_winners > 2) lines.push(`⚠ Du hast ${accuracy.missed_winners} profitable Trades verpasst! Edge Threshold senken?`);
    }
    const sources = state.source_ranking || [];
    if (sources.length) {
      lines.push('\nQuellen-Zuverlässigkeit:');
      for (const s of sources.slice(0, 5)) {
        lines.push(`  ${s.domain}: ${s.grade} (${(s.credibility*100).toFixed(0)}% korrekt, ${s.total}×)`);
      }
    }
  }

  if (type === 'forex') {
    const fxAcc = analyzeForexSignalAccuracy(state);
    if (fxAcc.ready) {
      lines.push(`\n═══ FOREX SIGNAL ACCURACY (${fxAcc.total_signals} beobachtet) ═══`);
      for (const i of fxAcc.insights.slice(0, 6)) lines.push(i);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════
// 6. PERIODIC LEARNING JOB (called by auto-pipeline)
// ═══════════════════════════════════════════

export async function runLearningCycle(state) {
  const results = { observations: 0, source_updates: 0, forex_resolved: 0, llm_resolved: 0 };

  results.observations = observeMarketOutcomes(state);
  const srcRanking = updateSourceCredibility(state);
  results.source_updates = (srcRanking || []).length;
  results.forex_resolved = observeForexSignalOutcomes(state);

  // Resolve LLM opinion outcomes
  const llmLog = state.forex_llm_log || [];
  const now = Date.now();
  for (const entry of llmLog) {
    if (entry.resolved) continue;
    const entryTime = new Date(entry.time).getTime();
    if (now - entryTime < 5 * 60 * 1000) continue;

    const latestSignal = (state.forex_signals?.signals || []).find(s => s.symbol === entry.symbol);
    if (latestSignal && latestSignal.current_price && !latestSignal.error) {
      entry.exit_price = latestSignal.current_price;
      const priceUp = latestSignal.current_price > entry.entry_price;
      const priceDown = latestSignal.current_price < entry.entry_price;
      const llmSaidBuy = entry.llm_take === true;
      const wasCall = entry.direction === 'CALL' || entry.llm_dir === 'CALL';

      if (llmSaidBuy) {
        entry.outcome = (wasCall && priceUp) || (!wasCall && priceDown) ? 'CORRECT' : 'WRONG';
      } else {
        // LLM said don't trade — correct if the trade would have lost
        entry.outcome = (wasCall && priceDown) || (!wasCall && priceUp) ? 'CORRECT' : 'WRONG';
      }
      entry.resolved = true;
      results.llm_resolved++;
    }
  }

  if (results.observations > 0 || results.forex_resolved > 0 || results.llm_resolved > 0) {
    logLine(state, 'info', `learning: ${results.observations} PM, ${results.forex_resolved} forex signals, ${results.llm_resolved} LLM opinions resolved, ${results.source_updates} sources`);
  }

  return results;
}

// ═══════════════════════════════════════════
// 8. NEWS IMPACT LEARNING — track if news predictions worked
// ═══════════════════════════════════════════

export function analyzeNewsImpact(state) {
  const logs = state.forex_news_trade_log || [];
  if (logs.length < 5) return { ready: false, count: logs.length };

  const bySentiment = { bullish: { correct: 0, wrong: 0 }, bearish: { correct: 0, wrong: 0 }, neutral: { correct: 0, wrong: 0 } };
  const bySource = {};
  const byImpact = { HIGH: { correct: 0, wrong: 0 }, normal: { correct: 0, wrong: 0 } };

  for (const log of logs) {
    if (log.outcome !== 'CORRECT' && log.outcome !== 'WRONG') continue;
    const bucket = log.outcome === 'CORRECT' ? 'correct' : 'wrong';
    if (bySentiment[log.news_sentiment]) bySentiment[log.news_sentiment][bucket]++;
    if (byImpact[log.news_impact]) byImpact[log.news_impact][bucket]++;
    if (!bySource[log.news_source]) bySource[log.news_source] = { correct: 0, wrong: 0 };
    bySource[log.news_source][bucket]++;
  }

  const insights = [];
  for (const [s, d] of Object.entries(bySentiment)) {
    const total = d.correct + d.wrong;
    if (total >= 3) {
      const acc = Math.round(d.correct / total * 100);
      insights.push(`${s}-News: ${acc}% korrekt (${total}×)${acc >= 60 ? ' ← zuverlässig' : acc < 40 ? ' ← unzuverlässig' : ''}`);
    }
  }
  for (const [src, d] of Object.entries(bySource)) {
    const total = d.correct + d.wrong;
    if (total >= 3) {
      const acc = Math.round(d.correct / total * 100);
      insights.push(`${src}: ${acc}% korrekt (${total}×)${acc >= 65 ? ' ← Top-Quelle' : acc < 40 ? ' ← schlecht' : ''}`);
    }
  }
  if (byImpact.HIGH.correct + byImpact.HIGH.wrong >= 3) {
    const acc = Math.round(byImpact.HIGH.correct / (byImpact.HIGH.correct + byImpact.HIGH.wrong) * 100);
    insights.push(`HIGH IMPACT News: ${acc}% prädiktiv`);
  }

  return {
    ready: true,
    total: logs.length,
    by_sentiment: bySentiment,
    by_source: bySource,
    by_impact: byImpact,
    insights,
  };
}

// Called when a forex trade is resolved - tracks what news was active
export function logNewsImpactForTrade(state, trade) {
  if (!trade || !trade.result) return;
  const news = state.forex_news;
  if (!news?.currency_sentiment) return;

  state.forex_news_trade_log = state.forex_news_trade_log || [];
  const parts = (trade.symbol || '').split('/');
  if (parts.length !== 2) return;

  const [base, quote] = parts;
  const baseData = news.currency_sentiment[base];
  const quoteData = news.currency_sentiment[quote];
  if (!baseData && !quoteData) return;

  // What did the news predict?
  const baseBias = baseData ? baseData.bullish - baseData.bearish : 0;
  const quoteBias = quoteData ? quoteData.bullish - quoteData.bearish : 0;
  const newsPredicts = baseBias > quoteBias ? 'CALL' : quoteBias > baseBias ? 'PUT' : 'NEUTRAL';
  const tradeWon = trade.result === 'WIN';

  const newsMatchedTrade = newsPredicts === trade.direction;
  const outcome = (newsMatchedTrade && tradeWon) || (!newsMatchedTrade && !tradeWon) ? 'CORRECT' : 'WRONG';

  const dominantSentiment = baseBias > 0 || quoteBias < 0 ? 'bullish' : baseBias < 0 || quoteBias > 0 ? 'bearish' : 'neutral';
  const topHeadline = (baseData?.headlines?.[0] || quoteData?.headlines?.[0]);

  state.forex_news_trade_log.unshift({
    time: new Date().toISOString(),
    symbol: trade.symbol,
    direction: trade.direction,
    trade_result: trade.result,
    news_predicts: newsPredicts,
    news_sentiment: dominantSentiment,
    news_impact: topHeadline?.impact || 'normal',
    news_source: topHeadline?.source || 'unknown',
    outcome,  // CORRECT if news aligned with trade outcome
  });
  state.forex_news_trade_log = state.forex_news_trade_log.slice(0, 200);
}

export function discoverKeywordsAndSources(state) {
  const discoveries = { new_keywords: [], bad_keywords: [], suggested_subreddits: [], log: [] };
  const outcomes = (state.prediction_outcomes || []).filter(o => o.prediction_correct !== null);
  if (outcomes.length < 5) return discoveries;

  // Extract keywords from successful vs failed predictions
  const winKeywords = {};
  const lossKeywords = {};
  const STOP = new Set(['will','the','and','for','this','that','with','from','have','been','more','than','what','when','does','not','are','was','were']);

  for (const o of outcomes) {
    const tokens = (o.question || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
    for (const token of tokens) {
      if (o.prediction_correct) { winKeywords[token] = (winKeywords[token] || 0) + 1; }
      else { lossKeywords[token] = (lossKeywords[token] || 0) + 1; }
    }
  }

  // Find keywords that appear in wins but rarely in losses
  for (const [word, winCount] of Object.entries(winKeywords)) {
    const lossCount = lossKeywords[word] || 0;
    if (winCount >= 3 && winCount > lossCount * 2) {
      discoveries.new_keywords.push({ keyword: word, wins: winCount, losses: lossCount, ratio: Number((winCount / Math.max(1, lossCount)).toFixed(1)) });
      discoveries.log.push(`✅ Keyword "${word}" erscheint ${winCount}× bei Gewinnen vs ${lossCount}× bei Verlusten`);
    }
  }

  // Find keywords strongly associated with losses
  for (const [word, lossCount] of Object.entries(lossKeywords)) {
    const winCount = winKeywords[word] || 0;
    if (lossCount >= 3 && lossCount > winCount * 2) {
      discoveries.bad_keywords.push({ keyword: word, wins: winCount, losses: lossCount });
      discoveries.log.push(`❌ Keyword "${word}" erscheint ${lossCount}× bei Verlusten — Märkte mit diesem Wort meiden?`);
    }
  }

  // Suggest subreddits based on market categories
  const categoryMap = {
    crypto: ['CryptoCurrency', 'Bitcoin', 'ethereum', 'defi'],
    finance: ['wallstreetbets', 'stocks', 'investing', 'StockMarket'],
    politics: ['politics', 'PoliticalDiscussion', 'NeutralPolitics'],
    sports: ['sportsbook', 'nfl', 'nba', 'soccer'],
    tech: ['technology', 'artificial', 'Futurology'],
    geopolitics: ['geopolitics', 'worldnews', 'InternationalNews'],
  };

  const tradedCategories = new Set();
  for (const t of (state.trades || []).concat(state.predictions || [])) {
    if (t.category) tradedCategories.add(t.category);
  }

  const currentSubs = String(state.config?.research_reddit_subreddits || '').toLowerCase().split(',').map(s => s.trim());
  for (const cat of tradedCategories) {
    const suggested = categoryMap[cat] || [];
    for (const sub of suggested) {
      if (!currentSubs.includes(sub.toLowerCase())) {
        discoveries.suggested_subreddits.push({ subreddit: sub, reason: `Du tradest ${cat}-Märkte → r/${sub} könnte relevant sein` });
        discoveries.log.push(`💡 Subreddit r/${sub} vorgeschlagen (Kategorie: ${cat})`);
      }
    }
  }

  // Store discoveries
  state.keyword_discoveries = discoveries;
  return discoveries;
}
