// forexSignals.js — Technical Analysis for Forex / Binary Options Signals
// Uses free APIs (TwelveData / Alpha Vantage) for candlestick data
// Calculates RSI, MACD, Bollinger Bands, Candlestick Patterns
// Generates BUY/SELL signals with confidence scores

import { fetchWithRetry, pushLiveComm } from './utils.js';
import { loadState } from './appState.js';

// ═══════════════════════════════════════════
// TECHNICAL INDICATORS
// ═══════════════════════════════════════════

function calcSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((s, p) => s + p, 0) / period;
}

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  if (emaFast === null || emaSlow === null) return null;
  // Calculate MACD line for last signal+1 periods
  const macdLine = [];
  for (let i = slow; i <= closes.length; i++) {
    const ef = calcEMA(closes.slice(0, i), fast);
    const es = calcEMA(closes.slice(0, i), slow);
    if (ef !== null && es !== null) macdLine.push(ef - es);
  }
  const signalLine = macdLine.length >= signal ? calcEMA(macdLine, signal) : null;
  const macd = macdLine[macdLine.length - 1] || 0;
  const histogram = signalLine !== null ? macd - signalLine : 0;
  return { macd: Number(macd.toFixed(6)), signal: signalLine ? Number(signalLine.toFixed(6)) : null, histogram: Number(histogram.toFixed(6)) };
}

function calcBollingerBands(closes, period = 20, stdDevMult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((s, p) => s + p, 0) / period;
  const variance = slice.reduce((s, p) => s + (p - sma) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: Number((sma + stdDevMult * stdDev).toFixed(6)),
    middle: Number(sma.toFixed(6)),
    lower: Number((sma - stdDevMult * stdDev).toFixed(6)),
    bandwidth: Number(((stdDevMult * 2 * stdDev) / sma * 100).toFixed(4)),
    position: Number(((closes[closes.length - 1] - (sma - stdDevMult * stdDev)) / (stdDevMult * 2 * stdDev)).toFixed(4)), // 0 = at lower, 1 = at upper
  };
}

function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return trs.slice(-period).reduce((s, t) => s + t, 0) / period;
}

function calcStochastic(closes, highs, lows, kPeriod = 14, dPeriod = 3) {
  if (closes.length < kPeriod) return null;
  const recentCloses = closes.slice(-kPeriod);
  const recentHighs = highs.slice(-kPeriod);
  const recentLows = lows.slice(-kPeriod);
  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);
  const range = highestHigh - lowestLow;
  const k = range > 0 ? ((closes[closes.length - 1] - lowestLow) / range) * 100 : 50;
  return { k: Number(k.toFixed(2)), d: null }; // Simplified — D would need history
}

// ═══════════════════════════════════════════
// CANDLESTICK PATTERNS
// ═══════════════════════════════════════════

function detectCandlestickPatterns(opens, highs, lows, closes) {
  const patterns = [];
  const n = closes.length;
  if (n < 3) return patterns;

  const i = n - 1; // Last candle
  const body = Math.abs(closes[i] - opens[i]);
  const range = highs[i] - lows[i];
  const upperWick = highs[i] - Math.max(opens[i], closes[i]);
  const lowerWick = Math.min(opens[i], closes[i]) - lows[i];
  const isBullish = closes[i] > opens[i];
  const prevBody = Math.abs(closes[i - 1] - opens[i - 1]);

  // Doji — very small body relative to range
  if (range > 0 && body / range < 0.1) {
    patterns.push({ name: 'Doji', signal: 'neutral', strength: 0.5, desc: 'Unentschlossenheit — mögliche Trendwende' });
  }

  // Hammer (bullish) — small body at top, long lower wick
  if (lowerWick > body * 2 && upperWick < body * 0.5 && isBullish) {
    patterns.push({ name: 'Hammer', signal: 'bullish', strength: 0.7, desc: 'Käufer drücken Preis nach oben — bullish Signal' });
  }

  // Shooting Star (bearish) — small body at bottom, long upper wick
  if (upperWick > body * 2 && lowerWick < body * 0.5 && !isBullish) {
    patterns.push({ name: 'Shooting Star', signal: 'bearish', strength: 0.7, desc: 'Verkäufer drücken Preis nach unten — bearish Signal' });
  }

  // Bullish Engulfing — current candle completely engulfs previous
  if (n >= 2 && isBullish && !closes[i - 1] > opens[i - 1] && body > prevBody * 1.2 && opens[i] <= closes[i - 1] && closes[i] >= opens[i - 1]) {
    patterns.push({ name: 'Bullish Engulfing', signal: 'bullish', strength: 0.8, desc: 'Starkes Kaufsignal — Käufer überwältigen Verkäufer' });
  }

  // Bearish Engulfing
  if (n >= 2 && !isBullish && closes[i - 1] > opens[i - 1] && body > prevBody * 1.2 && opens[i] >= closes[i - 1] && closes[i] <= opens[i - 1]) {
    patterns.push({ name: 'Bearish Engulfing', signal: 'bearish', strength: 0.8, desc: 'Starkes Verkaufssignal — Verkäufer überwältigen Käufer' });
  }

  // Three White Soldiers (bullish)
  if (n >= 3 && closes[i] > opens[i] && closes[i-1] > opens[i-1] && closes[i-2] > opens[i-2] && closes[i] > closes[i-1] && closes[i-1] > closes[i-2]) {
    patterns.push({ name: 'Three White Soldiers', signal: 'bullish', strength: 0.85, desc: '3 aufeinanderfolgende grüne Kerzen — starker Aufwärtstrend' });
  }

  // Three Black Crows (bearish)
  if (n >= 3 && closes[i] < opens[i] && closes[i-1] < opens[i-1] && closes[i-2] < opens[i-2] && closes[i] < closes[i-1] && closes[i-1] < closes[i-2]) {
    patterns.push({ name: 'Three Black Crows', signal: 'bearish', strength: 0.85, desc: '3 aufeinanderfolgende rote Kerzen — starker Abwärtstrend' });
  }

  return patterns;
}

// ═══════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════

const FOREX_PAIRS = [
  { symbol: 'EUR/USD', name: 'Euro / US Dollar' },
  { symbol: 'GBP/USD', name: 'British Pound / US Dollar' },
  { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen' },
  { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar' },
  { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc' },
  { symbol: 'USD/CAD', name: 'US Dollar / Canadian Dollar' },
  { symbol: 'NZD/USD', name: 'New Zealand Dollar / US Dollar' },
  { symbol: 'EUR/GBP', name: 'Euro / British Pound' },
];

export async function fetchCandleData(symbol, interval = '5min', outputsize = 50) {
  const cfg = loadState().config || {};
  const apiKey = String(cfg.forex_api_key || '').trim();
  const provider = String(cfg.forex_data_provider || 'twelvedata');
  if (provider === 'twelvedata') {
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey || 'demo'}`;
    const resp = await fetchWithRetry(url, {}, { label: 'forex-data', retries: 1, timeoutMs: 10000, silent: true });
    const data = await resp.json();
    if (data.status === 'error') throw new Error(data.message || 'TwelveData error');
    const values = (data.values || []).reverse(); // oldest first
    return values.map(v => ({
      time: v.datetime, open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume || 0),
    }));
  }

  if (provider === 'alphavantage') {
    const cleanSymbol = symbol.replace('/', '');
    const fn = interval.includes('min') ? 'TIME_SERIES_INTRADAY' : 'TIME_SERIES_DAILY';
    const url = `https://www.alphavantage.co/query?function=${fn}&symbol=${cleanSymbol}&interval=${interval}&outputsize=compact&apikey=${apiKey || 'demo'}`;
    const resp = await fetchWithRetry(url, {}, { label: 'forex-data', retries: 1, timeoutMs: 10000, silent: true });
    const data = await resp.json();
    const tsKey = Object.keys(data).find(k => k.includes('Time Series'));
    if (!tsKey) throw new Error('AlphaVantage: no time series data');
    const entries = Object.entries(data[tsKey]).reverse().slice(-outputsize);
    return entries.map(([dt, v]) => ({
      time: dt, open: Number(v['1. open']), high: Number(v['2. high']), low: Number(v['3. low']), close: Number(v['4. close']), volume: Number(v['5. volume'] || 0),
    }));
  }

  throw new Error(`Unknown forex provider: ${provider}`);
}

// ═══════════════════════════════════════════
// SIGNAL GENERATION
// ═══════════════════════════════════════════

function generateSignal(candles, symbol) {
  if (!candles || candles.length < 30) return { symbol, error: 'Nicht genug Daten (min. 30 Kerzen)' };

  const closes = candles.map(c => c.close);
  const opens = candles.map(c => c.open);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];

  // Calculate all indicators
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const bb = calcBollingerBands(closes, 20, 2);
  const atr = calcATR(highs, lows, closes, 14);
  const stoch = calcStochastic(closes, highs, lows, 14, 3);
  const sma50 = calcSMA(closes, Math.min(50, closes.length));
  const sma20 = calcSMA(closes, 20);
  const patterns = detectCandlestickPatterns(opens, highs, lows, closes);

  // Score each indicator: -1 (strong sell) to +1 (strong buy)
  const scores = {};

  // RSI
  if (rsi !== null) {
    if (rsi < 20) scores.rsi = { value: rsi, score: 0.9, reason: `RSI ${rsi.toFixed(1)} — stark überverkauft` };
    else if (rsi < 30) scores.rsi = { value: rsi, score: 0.6, reason: `RSI ${rsi.toFixed(1)} — überverkauft` };
    else if (rsi > 80) scores.rsi = { value: rsi, score: -0.9, reason: `RSI ${rsi.toFixed(1)} — stark überkauft` };
    else if (rsi > 70) scores.rsi = { value: rsi, score: -0.6, reason: `RSI ${rsi.toFixed(1)} — überkauft` };
    else scores.rsi = { value: rsi, score: 0, reason: `RSI ${rsi.toFixed(1)} — neutral` };
  }

  // MACD
  if (macd) {
    const crossover = macd.histogram > 0 && macd.macd > 0;
    const crossunder = macd.histogram < 0 && macd.macd < 0;
    if (crossover) scores.macd = { value: macd, score: 0.7, reason: `MACD bullish — Histogram positiv (${macd.histogram.toFixed(5)})` };
    else if (crossunder) scores.macd = { value: macd, score: -0.7, reason: `MACD bearish — Histogram negativ (${macd.histogram.toFixed(5)})` };
    else scores.macd = { value: macd, score: macd.histogram > 0 ? 0.3 : -0.3, reason: `MACD ${macd.histogram > 0 ? 'leicht bullish' : 'leicht bearish'}` };
  }

  // Bollinger Bands
  if (bb) {
    if (bb.position < 0.05) scores.bollinger = { value: bb, score: 0.8, reason: `Preis am unteren Band — möglicher Bounce (Position: ${(bb.position*100).toFixed(0)}%)` };
    else if (bb.position > 0.95) scores.bollinger = { value: bb, score: -0.8, reason: `Preis am oberen Band — möglicher Rücksetzer (Position: ${(bb.position*100).toFixed(0)}%)` };
    else if (bb.position < 0.3) scores.bollinger = { value: bb, score: 0.3, reason: `Preis im unteren Bereich der Bänder` };
    else if (bb.position > 0.7) scores.bollinger = { value: bb, score: -0.3, reason: `Preis im oberen Bereich der Bänder` };
    else scores.bollinger = { value: bb, score: 0, reason: `Preis in der Mitte der Bänder` };
  }

  // Trend (SMA)
  if (sma20 && sma50) {
    if (currentPrice > sma20 && sma20 > sma50) scores.trend = { score: 0.6, reason: `Aufwärtstrend — Preis > SMA20 > SMA50` };
    else if (currentPrice < sma20 && sma20 < sma50) scores.trend = { score: -0.6, reason: `Abwärtstrend — Preis < SMA20 < SMA50` };
    else scores.trend = { score: 0, reason: `Kein klarer Trend` };
  }

  // Stochastic
  if (stoch) {
    if (stoch.k < 20) scores.stochastic = { value: stoch.k, score: 0.5, reason: `Stochastic ${stoch.k.toFixed(0)}% — überverkauft` };
    else if (stoch.k > 80) scores.stochastic = { value: stoch.k, score: -0.5, reason: `Stochastic ${stoch.k.toFixed(0)}% — überkauft` };
    else scores.stochastic = { value: stoch.k, score: 0, reason: `Stochastic ${stoch.k.toFixed(0)}% — neutral` };
  }

  // Candlestick patterns
  if (patterns.length) {
    const strongest = patterns.sort((a, b) => b.strength - a.strength)[0];
    scores.candlestick = { score: strongest.signal === 'bullish' ? strongest.strength : strongest.signal === 'bearish' ? -strongest.strength : 0, reason: `${strongest.name}: ${strongest.desc}`, patterns };
  }

  // Aggregate signal
  const allScores = Object.values(scores).map(s => s.score);
  const avgScore = allScores.length ? allScores.reduce((s, v) => s + v, 0) / allScores.length : 0;
  const agreement = allScores.length ? allScores.filter(s => Math.sign(s) === Math.sign(avgScore)).length / allScores.length : 0;

  let direction = 'WAIT';
  let confidence = Math.abs(avgScore) * agreement;
  if (avgScore > 0.25 && agreement >= 0.5) direction = 'CALL'; // BUY / UP
  if (avgScore < -0.25 && agreement >= 0.5) direction = 'PUT';  // SELL / DOWN

  // Confidence thresholds
  const signalStrength = confidence >= 0.6 ? 'STRONG' : confidence >= 0.4 ? 'MEDIUM' : confidence >= 0.2 ? 'WEAK' : 'NONE';

  return {
    symbol,
    time: candles[candles.length - 1].time,
    current_price: currentPrice,
    price_change_pct: Number(((currentPrice - prevPrice) / prevPrice * 100).toFixed(4)),
    direction,
    signal_strength: signalStrength,
    confidence: Number(confidence.toFixed(3)),
    avg_score: Number(avgScore.toFixed(3)),
    agreement_pct: Number((agreement * 100).toFixed(0)),
    indicators: scores,
    patterns,
    atr: atr ? Number(atr.toFixed(6)) : null,
    bollinger: bb,
    candle_count: candles.length,
  };
}

// ═══════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════

export async function scanForexSignals(pairs = null, interval = '5min') {
  const cfg = loadState().config || {};
  const pairsToScan = pairs || (cfg.forex_pairs || 'EUR/USD,GBP/USD,USD/JPY,AUD/USD').split(',').map(p => p.trim()).filter(Boolean);
  const signals = [];

  for (const symbol of pairsToScan) {
    try {
      const candles = await fetchCandleData(symbol, interval, 60);
      const signal = generateSignal(candles, symbol);
      signal.interval = interval;
      signals.push(signal);
      pushLiveComm('forex_signal', { symbol, direction: signal.direction, strength: signal.signal_strength, confidence: signal.confidence });
    } catch (e) {
      signals.push({ symbol, error: String(e.message).slice(0, 100) });
      pushLiveComm('forex_error', { symbol, error: String(e.message).slice(0, 80) });
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  return { time: new Date().toISOString(), interval, signals };
}

// LLM-enhanced signal: sends indicators + learning data to LLM for smarter signals
export async function getForexLlmOpinion(signal, state) {
  const cfg = state.config || {};
  const providers = state.providers || {};
  const learningContext = buildForexLlmContext(state);

  // Find an active LLM provider
  const providerOrder = ['gemini', 'ollama_cloud', 'openai', 'claude', 'local_ollama', 'kimi_direct'];
  let providerName = null, providerCfg = null;
  for (const name of providerOrder) {
    const p = providers[name] || {};
    if (p.enabled && (String(p.api_key || '').trim() || name === 'local_ollama')) {
      providerName = name; providerCfg = p; break;
    }
  }
  if (!providerName) return { opinion: null, reason: 'no_llm_available' };

  const indSummary = Object.entries(signal.indicators || {}).map(([name, ind]) =>
    `${name.toUpperCase()}: Score ${ind.score > 0 ? '+' : ''}${ind.score.toFixed(1)} — ${ind.reason}`
  ).join('\n');

  const prompt = `You are a forex trading analyst. Analyze this technical signal and give your opinion.

PAIR: ${signal.symbol}
CURRENT PRICE: ${signal.current_price?.toFixed(5)}
PRICE CHANGE: ${signal.price_change_pct > 0 ? '+' : ''}${signal.price_change_pct?.toFixed(3)}%
BOT SIGNAL: ${signal.direction} (Confidence: ${(signal.confidence * 100).toFixed(0)}%, Strength: ${signal.signal_strength})
AGREEMENT: ${signal.agreement_pct}% of indicators agree

INDICATORS:
${indSummary}

${signal.patterns?.length ? `CANDLESTICK PATTERNS: ${signal.patterns.map(p => p.name).join(', ')}` : 'No candlestick patterns detected.'}

${signal.bollinger ? `BOLLINGER: Price at ${(signal.bollinger.position * 100).toFixed(0)}% of bands (0%=lower, 100%=upper)` : ''}
${learningContext ? learningContext : '(No historical trade data yet)'}

QUESTION: Based on the technical indicators, patterns, and historical performance data above, should the trader take this ${signal.direction} trade on ${signal.symbol}?

Return ONLY JSON:
{"take_trade": true/false, "adjusted_confidence": 0.XX, "reason": "1-2 sentences explaining why or why not, referencing specific indicators and any learning data"}`;

  try {
    const { queryLlmProvider } = await import('./predict.js');
    const result = await queryLlmProvider(providerName, providerCfg, cfg, prompt);
    return { opinion: result, provider: providerName };
  } catch (e) {
    return { opinion: null, reason: e.message };
  }
}

export { FOREX_PAIRS };

// ═══════════════════════════════════════════
// FOREX PAPER TRADING
// ═══════════════════════════════════════════

export function openForexPaperTrade(state, { symbol, direction, duration_min, amount, signal_data }) {
  const cfg = state.config || {};
  state.forex_trades = state.forex_trades || [];
  state.forex_bankroll = state.forex_bankroll ?? Number(cfg.forex_bankroll || 100);

  if (amount > state.forex_bankroll) return { ok: false, error: `Einsatz $${amount} > Bankroll $${state.forex_bankroll}` };
  if (amount <= 0) return { ok: false, error: 'Einsatz muss > $0 sein' };

  const maxConcurrent = Number(cfg.forex_max_concurrent || 2);
  const openCount = state.forex_trades.filter(t => t.status === 'OPEN').length;
  if (openCount >= maxConcurrent) return { ok: false, error: `Max ${maxConcurrent} gleichzeitige Trades erreicht (${openCount} offen)` };

  // Extract indicator snapshot from signal for learning
  const indicators = {};
  if (signal_data?.indicators) {
    for (const [name, ind] of Object.entries(signal_data.indicators)) {
      indicators[name] = { score: ind.score, value: typeof ind.value === 'object' ? undefined : ind.value };
    }
  }

  const trade = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    symbol, direction,
    duration_min: Number(duration_min),
    amount: Number(amount),
    entry_price: null,
    exit_price: null,
    opened_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + Number(duration_min) * 60 * 1000).toISOString(),
    status: 'OPEN',
    result: null,
    payout_pct: Number(cfg.forex_payout_pct || 85),
    pnl: 0,
    // Learning data
    interval: signal_data?.interval || cfg.forex_interval || '5min',
    confidence: signal_data?.confidence || 0,
    signal_strength: signal_data?.signal_strength || 'NONE',
    avg_score: signal_data?.avg_score || 0,
    agreement_pct: signal_data?.agreement_pct || 0,
    indicators,
    patterns: (signal_data?.patterns || []).map(p => p.name),
    hour: new Date().getUTCHours(),
    day_of_week: new Date().getUTCDay(),
  };

  state.forex_bankroll -= trade.amount;
  state.forex_trades.unshift(trade);
  return { ok: true, trade };
}

export async function resolveForexTrades(state) {
  state.forex_trades = state.forex_trades || [];
  const cfg = state.config || {};
  const now = Date.now();
  let resolved = 0;

  for (const trade of state.forex_trades) {
    if (trade.status !== 'OPEN') continue;
    const expiresAt = new Date(trade.expires_at).getTime();
    if (now < expiresAt) continue; // Not expired yet

    // Fetch current price
    try {
      const candles = await fetchCandleData(trade.symbol, '1min', 3);
      const currentPrice = candles[candles.length - 1]?.close;
      if (!currentPrice) { trade.status = 'ERROR'; trade.result = 'ERROR'; continue; }

      trade.exit_price = currentPrice;

      // Determine win/loss
      if (trade.direction === 'CALL') {
        trade.result = currentPrice > trade.entry_price ? 'WIN' : currentPrice < trade.entry_price ? 'LOSS' : 'DRAW';
      } else {
        trade.result = currentPrice < trade.entry_price ? 'WIN' : currentPrice > trade.entry_price ? 'LOSS' : 'DRAW';
      }

      // Calculate payout
      if (trade.result === 'WIN') {
        const payout = trade.amount * (1 + trade.payout_pct / 100);
        trade.pnl = Number((payout - trade.amount).toFixed(2));
        state.forex_bankroll = Number((state.forex_bankroll + payout).toFixed(2));
      } else if (trade.result === 'DRAW') {
        trade.pnl = 0;
        state.forex_bankroll = Number((state.forex_bankroll + trade.amount).toFixed(2)); // Refund
      } else {
        trade.pnl = -trade.amount;
        // Already deducted at open
      }

      trade.status = 'CLOSED';
      resolved++;
      pushLiveComm('forex_trade_resolved', { symbol: trade.symbol, direction: trade.direction, result: trade.result, pnl: trade.pnl });
    } catch (e) {
      // Can't fetch price — try again next cycle
      pushLiveComm('forex_resolve_error', { symbol: trade.symbol, error: e.message });
    }
  }

  return resolved;
}

export function getForexStats(state) {
  const trades = (state.forex_trades || []).filter(t => t.status === 'CLOSED');
  const wins = trades.filter(t => t.result === 'WIN').length;
  const losses = trades.filter(t => t.result === 'LOSS').length;
  const totalPnl = trades.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const openTrades = (state.forex_trades || []).filter(t => t.status === 'OPEN');
  return {
    bankroll: state.forex_bankroll ?? Number(state.config?.forex_bankroll || 100),
    starting_bankroll: Number(state.config?.forex_bankroll || 100),
    total_trades: trades.length,
    open_trades: openTrades.length,
    wins, losses,
    win_rate: trades.length ? Number((wins / trades.length * 100).toFixed(1)) : 0,
    total_pnl: Number(totalPnl.toFixed(2)),
    pnl_pct: Number(state.config?.forex_bankroll || 100) > 0 ? Number((totalPnl / Number(state.config?.forex_bankroll || 100) * 100).toFixed(1)) : 0,
    breakeven_rate: 54, // At 85% payout
    open: openTrades.map(t => ({
      ...t,
      remaining_sec: Math.max(0, Math.round((new Date(t.expires_at).getTime() - Date.now()) / 1000)),
    })),
  };
}

// ═══════════════════════════════════════════
// FOREX LEARNING ENGINE
// ═══════════════════════════════════════════

export function analyzeForexLearning(state) {
  const closed = (state.forex_trades || []).filter(t => t.status === 'CLOSED' && t.result);
  if (closed.length < 3) return { ready: false, min_trades: 3, current: closed.length, insights: [] };

  const insights = [];

  // 1. Performance by pair
  const byPair = {};
  for (const t of closed) {
    const key = t.symbol || 'unknown';
    if (!byPair[key]) byPair[key] = { wins: 0, losses: 0, pnl: 0 };
    if (t.result === 'WIN') byPair[key].wins++;
    else if (t.result === 'LOSS') byPair[key].losses++;
    byPair[key].pnl += Number(t.pnl || 0);
  }
  const pairStats = Object.entries(byPair).map(([pair, s]) => ({
    pair, total: s.wins + s.losses, wins: s.wins, losses: s.losses,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
    pnl: Number(s.pnl.toFixed(2)),
    profitable: s.pnl > 0,
  })).sort((a, b) => b.win_rate - a.win_rate);

  // 2. Performance by timeframe/duration
  const byDuration = {};
  for (const t of closed) {
    const key = `${t.duration_min || '?'}min`;
    if (!byDuration[key]) byDuration[key] = { wins: 0, losses: 0, pnl: 0 };
    if (t.result === 'WIN') byDuration[key].wins++;
    else if (t.result === 'LOSS') byDuration[key].losses++;
    byDuration[key].pnl += Number(t.pnl || 0);
  }
  const durationStats = Object.entries(byDuration).map(([dur, s]) => ({
    duration: dur, total: s.wins + s.losses, wins: s.wins,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
    pnl: Number(s.pnl.toFixed(2)),
  })).sort((a, b) => b.win_rate - a.win_rate);

  // 3. Performance by direction (CALL vs PUT)
  const byDir = { CALL: { wins: 0, losses: 0, pnl: 0 }, PUT: { wins: 0, losses: 0, pnl: 0 } };
  for (const t of closed) {
    const d = byDir[t.direction] || byDir.CALL;
    if (t.result === 'WIN') d.wins++; else if (t.result === 'LOSS') d.losses++;
    d.pnl += Number(t.pnl || 0);
  }
  const dirStats = Object.entries(byDir).map(([dir, s]) => ({
    direction: dir, total: s.wins + s.losses, wins: s.wins,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
    pnl: Number(s.pnl.toFixed(2)),
  }));

  // 4. Performance by signal strength
  const byStrength = {};
  for (const t of closed) {
    const key = t.signal_strength || 'UNKNOWN';
    if (!byStrength[key]) byStrength[key] = { wins: 0, losses: 0 };
    if (t.result === 'WIN') byStrength[key].wins++; else if (t.result === 'LOSS') byStrength[key].losses++;
  }
  const strengthStats = Object.entries(byStrength).map(([str, s]) => ({
    strength: str, total: s.wins + s.losses, wins: s.wins,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.win_rate - a.win_rate);

  // 5. Performance by hour of day
  const byHour = {};
  for (const t of closed) {
    const h = t.hour ?? new Date(t.opened_at).getUTCHours();
    if (!byHour[h]) byHour[h] = { wins: 0, losses: 0 };
    if (t.result === 'WIN') byHour[h].wins++; else if (t.result === 'LOSS') byHour[h].losses++;
  }
  const hourStats = Object.entries(byHour).map(([h, s]) => ({
    hour: Number(h), total: s.wins + s.losses, wins: s.wins,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.win_rate - a.win_rate);

  // 6. Performance by indicator — which indicators predict winners?
  const byIndicator = {};
  for (const t of closed) {
    for (const [name, ind] of Object.entries(t.indicators || {})) {
      if (!byIndicator[name]) byIndicator[name] = { correct: 0, wrong: 0 };
      const indSaysUp = ind.score > 0.2;
      const indSaysDown = ind.score < -0.2;
      const tradeWon = t.result === 'WIN';
      // Indicator was "correct" if it agreed with the winning direction
      if ((t.direction === 'CALL' && indSaysUp && tradeWon) || (t.direction === 'PUT' && indSaysDown && tradeWon)) {
        byIndicator[name].correct++;
      } else if ((t.direction === 'CALL' && indSaysUp && !tradeWon) || (t.direction === 'PUT' && indSaysDown && !tradeWon)) {
        byIndicator[name].wrong++;
      }
    }
  }
  const indicatorStats = Object.entries(byIndicator)
    .filter(([, s]) => s.correct + s.wrong >= 3)
    .map(([name, s]) => ({
      indicator: name, total: s.correct + s.wrong, correct: s.correct,
      accuracy: s.correct + s.wrong > 0 ? Number((s.correct / (s.correct + s.wrong) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.accuracy - a.accuracy);

  // 7. Generate human-readable insights
  const bestPair = pairStats.find(p => p.total >= 3 && p.win_rate >= 55);
  const worstPair = pairStats.find(p => p.total >= 3 && p.win_rate < 45);
  const bestDur = durationStats.find(d => d.total >= 3 && d.win_rate >= 55);
  const bestIndicator = indicatorStats.find(i => i.accuracy >= 60);
  const worstIndicator = indicatorStats.find(i => i.accuracy < 40 && i.total >= 3);
  const bestHour = hourStats.find(h => h.total >= 3 && h.win_rate >= 60);
  const bestStrength = strengthStats.find(s => s.total >= 3 && s.win_rate >= 55);

  if (bestPair) insights.push(`✅ ${bestPair.pair} performt gut: ${bestPair.win_rate}% Win Rate (${bestPair.total} Trades)`);
  if (worstPair) insights.push(`❌ ${worstPair.pair} performt schlecht: ${worstPair.win_rate}% Win Rate — meiden!`);
  if (bestDur) insights.push(`✅ ${bestDur.duration} Trades gewinnen öfter: ${bestDur.win_rate}% Win Rate`);
  if (bestIndicator) insights.push(`✅ ${bestIndicator.indicator.toUpperCase()} ist der zuverlässigste Indikator: ${bestIndicator.accuracy}% korrekt`);
  if (worstIndicator) insights.push(`❌ ${worstIndicator.indicator.toUpperCase()} ist unzuverlässig: nur ${worstIndicator.accuracy}% korrekt — weniger Gewicht geben`);
  if (bestHour) insights.push(`✅ Um ${bestHour.hour}:00 UTC traden → ${bestHour.win_rate}% Win Rate`);
  if (bestStrength) insights.push(`✅ ${bestStrength.strength}-Signale gewinnen öfter: ${bestStrength.win_rate}%`);

  return {
    ready: true,
    total_trades: closed.length,
    overall_win_rate: closed.length ? Number((closed.filter(t => t.result === 'WIN').length / closed.length * 100).toFixed(1)) : 0,
    by_pair: pairStats,
    by_duration: durationStats,
    by_direction: dirStats,
    by_strength: strengthStats,
    by_hour: hourStats,
    by_indicator: indicatorStats,
    insights,
  };
}

// Build LLM context from learning data
export function buildForexLlmContext(state) {
  const learning = analyzeForexLearning(state);
  if (!learning.ready) return '';

  const lines = [
    `\n═══ FOREX LEARNING DATA (${learning.total_trades} abgeschlossene Trades) ═══`,
    `Overall Win Rate: ${learning.overall_win_rate}% (Break-even: 54%)`,
  ];

  if (learning.by_pair.length) {
    lines.push('\nPerformance pro Paar:');
    for (const p of learning.by_pair.slice(0, 5)) {
      lines.push(`  ${p.pair}: ${p.win_rate}% WR (${p.total} Trades, PnL: ${p.pnl >= 0 ? '+' : ''}$${p.pnl})`);
    }
  }

  if (learning.by_duration.length) {
    lines.push('\nPerformance pro Dauer:');
    for (const d of learning.by_duration) {
      lines.push(`  ${d.duration}: ${d.win_rate}% WR (${d.total} Trades)`);
    }
  }

  if (learning.by_indicator.length) {
    lines.push('\nIndikator-Zuverlässigkeit:');
    for (const i of learning.by_indicator) {
      lines.push(`  ${i.indicator.toUpperCase()}: ${i.accuracy}% korrekt (${i.total} Signale)`);
    }
  }

  if (learning.by_hour.length > 1) {
    const best = learning.by_hour[0];
    const worst = learning.by_hour[learning.by_hour.length - 1];
    lines.push(`\nBeste Tageszeit: ${best.hour}:00 UTC (${best.win_rate}% WR)`);
    lines.push(`Schlechteste Tageszeit: ${worst.hour}:00 UTC (${worst.win_rate}% WR)`);
  }

  if (learning.insights.length) {
    lines.push('\nLessons Learned:');
    for (const i of learning.insights) lines.push(`  ${i}`);
  }

  return lines.join('\n');
}
