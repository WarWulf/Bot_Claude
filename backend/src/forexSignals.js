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
  const state = loadState();
  const cfg = state.config || {};
  const apiKey = String(cfg.forex_api_key || '').trim();
  const provider = String(cfg.forex_data_provider || 'twelvedata');

  if (!apiKey) {
    throw new Error('Kein Forex API-Key! Gehe zu Einstellungen → Forex → trage deinen Key ein. Kostenlos bei twelvedata.com');
  }

  // API QUOTA TRACKING — track daily request count per provider
  const todayKey = new Date().toISOString().slice(0, 10);
  state.api_quota = state.api_quota || {};
  if (!state.api_quota[provider] || state.api_quota[provider].date !== todayKey) {
    state.api_quota[provider] = { date: todayKey, count: 0, last_reset: todayKey };
  }
  const quotaLimit = provider === 'twelvedata' ? 800 : provider === 'alphavantage' ? 500 : 1000;
  const currentCount = state.api_quota[provider].count;
  if (currentCount >= quotaLimit) {
    pushLiveComm('api_quota_exhausted', { provider, limit: quotaLimit, count: currentCount });
    throw new Error(`${provider}: Tageslimit erreicht (${currentCount}/${quotaLimit}). Reset um Mitternacht UTC. Upgrade den Plan oder warte.`);
  }
  if (currentCount >= quotaLimit * 0.8 && currentCount < quotaLimit * 0.8 + 1) {
    pushLiveComm('api_quota_warning', { provider, used: currentCount, limit: quotaLimit, pct: 80 });
  }
  state.api_quota[provider].count++;
  // Save quota (debounced — this is high-frequency)
  try { const { saveStateDebounced } = await import('./appState.js'); saveStateDebounced(state, 5000); } catch {}

  if (provider === 'twelvedata') {
    // TwelveData uses EUR/USD format directly
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
    pushLiveComm('forex_fetch', { url: url.replace(apiKey, '***'), symbol, interval });
    const resp = await fetchWithRetry(url, {}, { label: 'forex-data', retries: 1, timeoutMs: 12000, silent: true });
    const data = await resp.json();
    if (data.status === 'error') {
      const msg = String(data.message || '');
      if (msg.includes('apikey') || msg.includes('API key')) throw new Error('TwelveData API-Key ungültig. Prüfe den Key in den Einstellungen.');
      if (msg.includes('symbol')) throw new Error(`TwelveData: Symbol "${symbol}" nicht gefunden. Probiere z.B. EUR/USD`);
      throw new Error(`TwelveData: ${msg.slice(0, 120)}`);
    }
    if (!data.values || !data.values.length) throw new Error(`TwelveData: keine Daten für ${symbol} ${interval}. Markt geschlossen?`);
    const values = (data.values || []).reverse();
    return values.map(v => ({
      time: v.datetime, open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume || 0),
    }));
  }

  if (provider === 'alphavantage') {
    // AlphaVantage uses FX_INTRADAY with from_symbol/to_symbol
    const parts = symbol.split('/');
    if (parts.length !== 2) throw new Error(`Ungültiges Symbol: ${symbol}. Format: EUR/USD`);
    const [from, to] = parts;
    const fn = interval.includes('min') ? 'FX_INTRADAY' : 'FX_DAILY';
    const url = fn === 'FX_INTRADAY'
      ? `https://www.alphavantage.co/query?function=${fn}&from_symbol=${from}&to_symbol=${to}&interval=${interval}&outputsize=compact&apikey=${apiKey}`
      : `https://www.alphavantage.co/query?function=${fn}&from_symbol=${from}&to_symbol=${to}&outputsize=compact&apikey=${apiKey}`;
    pushLiveComm('forex_fetch', { url: url.replace(apiKey, '***'), symbol, interval });
    const resp = await fetchWithRetry(url, {}, { label: 'forex-data', retries: 1, timeoutMs: 12000, silent: true });
    const data = await resp.json();
    if (data['Error Message']) throw new Error(`AlphaVantage: ${data['Error Message'].slice(0, 100)}`);
    if (data['Note']) throw new Error('AlphaVantage: Rate Limit erreicht. Warte 1 Minute.');
    const tsKey = Object.keys(data).find(k => k.includes('Time Series'));
    if (!tsKey) throw new Error(`AlphaVantage: keine Daten für ${symbol}. API-Key korrekt?`);
    const entries = Object.entries(data[tsKey]).reverse().slice(-outputsize);
    return entries.map(([dt, v]) => ({
      time: dt, open: Number(v['1. open']), high: Number(v['2. high']), low: Number(v['3. low']), close: Number(v['4. close']), volume: 0,
    }));
  }

  throw new Error(`Unbekannter Provider: ${provider}. Nutze 'twelvedata' oder 'alphavantage'.`);
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
  const apiKey = String(cfg.forex_api_key || '').trim();
  const provider = String(cfg.forex_data_provider || 'twelvedata');
  const pairsToScan = pairs || (cfg.forex_pairs || 'EUR/USD,GBP/USD,USD/JPY,AUD/USD').split(',').map(p => p.trim()).filter(Boolean);
  const signals = [];

  // Pre-flight check
  if (!apiKey) {
    const errMsg = `Kein ${provider} API-Key eingetragen. Gehe zu Einstellungen → Forex → API Key. Kostenlos bei ${provider === 'twelvedata' ? 'twelvedata.com' : 'alphavantage.co'}`;
    for (const symbol of pairsToScan) signals.push({ symbol, error: errMsg });
    pushLiveComm('forex_error', { symbol: 'ALL', error: errMsg });
    return { time: new Date().toISOString(), interval, signals, error: errMsg };
  }

  for (const symbol of pairsToScan) {
    try {
      pushLiveComm('forex_fetching', { symbol, interval, provider });
      const candles = await fetchCandleData(symbol, interval, 60);
      if (!candles.length) {
        signals.push({ symbol, error: `Keine Kerzen-Daten von ${provider}. Markt geschlossen?` });
        continue;
      }
      const signal = generateSignal(candles, symbol);
      signal.interval = interval;
      signals.push(signal);
      pushLiveComm('forex_signal_ok', { symbol, direction: signal.direction, strength: signal.signal_strength, confidence: signal.confidence?.toFixed(2), price: signal.current_price?.toFixed(5) });
    } catch (e) {
      const fullError = String(e.message || e).slice(0, 200);
      signals.push({ symbol, error: fullError });
      pushLiveComm('forex_error', { symbol, error: fullError, provider, interval });
      console.error(`[forex] ${symbol} ${interval} error:`, fullError);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  const okCount = signals.filter(s => !s.error).length;
  const errCount = signals.filter(s => s.error).length;
  pushLiveComm('forex_scan_done', { ok: okCount, errors: errCount, interval, provider });

  return { time: new Date().toISOString(), interval, signals, provider, api_key_set: !!apiKey };
}

// LLM deep analysis — uses ENSEMBLE of all available LLMs with weights
export async function getForexLlmOpinion(signal, state, newsContext = '') {
  const cfg = state.config || {};
  const providers = state.providers || {};
  const learningContext = buildForexLlmContext(state);
  const learning = analyzeForexLearning(state);

  const providerOrder = ['openai', 'claude', 'gemini', 'ollama_cloud', 'local_ollama', 'kimi_direct'];
  const rawWeights = {
    openai: Number(cfg.llm_weight_openai ?? 0.35),
    claude: Number(cfg.llm_weight_claude ?? 0.25),
    gemini: Number(cfg.llm_weight_gemini ?? 0.2),
    ollama_cloud: Number(cfg.llm_weight_ollama_cloud ?? 0.2),
    local_ollama: Number(cfg.llm_weight_local_ollama ?? 0.15),
    kimi_direct: Number(cfg.llm_weight_kimi ?? 0.15),
  };

  const active = providerOrder.filter(name => {
    const p = providers[name] || {};
    return p.enabled && (String(p.api_key || '').trim() || name === 'local_ollama');
  });
  if (!active.length) return { opinion: null, reason: 'no_llm_available' };

  const indSummary = Object.entries(signal.indicators || {}).map(([name, ind]) =>
    `${name.toUpperCase()}: ${ind.score > 0 ? '+' : ''}${ind.score?.toFixed(1)||'0'} — ${ind.reason || ''}`
  ).join('\n');

  const pairData = learning.ready ? learning.by_pair?.find(p => p.pair === signal.symbol) : null;
  const pairWarning = pairData && pairData.total >= 3 && pairData.win_rate < 45
    ? `\n⚠ CRITICAL: ${signal.symbol} has ${pairData.win_rate}% WR in ${pairData.total} trades. AVOID.\n` : '';
  const currentHour = new Date().getUTCHours();

  const prompt = `You are an expert forex analyst. You make data-driven decisions. Historical data OVERRIDES current indicators.

═══ SIGNAL ═══
${signal.symbol} | ${signal.current_price?.toFixed(5)||'?'} | ${signal.direction} | Confidence: ${signal.confidence!=null?(signal.confidence*100).toFixed(0):'?'}% | Strength: ${signal.signal_strength||'?'} | Agreement: ${signal.agreement_pct||'?'}% | ${currentHour}:00 UTC

═══ INDICATORS ═══
${indSummary}
${signal.patterns?.length ? `Patterns: ${signal.patterns.map(p=>typeof p==='string'?p:p.name).join(', ')}` : ''}
${signal.bollinger ? `Bollinger: ${typeof signal.bollinger.position==='number'?(signal.bollinger.position*100).toFixed(0):'?'}%` : ''}
${signal.atr ? `ATR: ${signal.atr.toFixed(6)} ${signal.atr>0.001?'(HIGH vol)':'(LOW vol)'}` : ''}
${pairWarning}${learningContext || '(No history yet.)'}
${newsContext || '(No news data.)'}

═══ ANALYZE ═══
1. Indicators agree or conflict?
2. HISTORICAL DATA support/contradict?
3. NEWS support/contradict? HIGH IMPACT event?
4. Current hour/pair/direction historically profitable?
5. Indicator combos active — good track record?
6. Red flags: low agreement, weak, streak, bad pair, conflicting news?

Be honest. Data overrides indicators.

═══ JSON ONLY ═══
{"take_trade":true/false,"adjusted_confidence":0.XX,"direction":"CALL/PUT/WAIT","reason":"2-3 sentences","risk_level":"low/medium/high"}`;

  const { queryLlmProvider } = await import('./predict.js');
  const opinions = {};
  const errors = [];

  // Query ALL active providers in parallel
  const jobs = active.map(async (name) => {
    try {
      const result = await queryLlmProvider(name, providers[name], cfg, prompt);
      if (result) opinions[name] = result;
    } catch (e) {
      errors.push(`${name}: ${e.message.slice(0, 60)}`);
    }
  });
  await Promise.all(jobs);

  if (!Object.keys(opinions).length) return { opinion: null, reason: 'all_llms_failed', errors, providers_tried: active };

  // Ensemble: weighted vote on take_trade + avg confidence
  const totalWeight = Object.keys(opinions).reduce((s, n) => s + Math.max(0, rawWeights[n] || 0.2), 0);
  let weightedTake = 0, weightedConf = 0;
  const reasons = [];
  for (const [name, op] of Object.entries(opinions)) {
    const w = Math.max(0, rawWeights[name] || 0.2) / totalWeight;
    weightedTake += (op.take_trade ? 1 : 0) * w;
    weightedConf += Number(op.adjusted_confidence || 0.5) * w;
    if (op.reason) reasons.push(`${name}: ${op.reason.slice(0, 120)}`);
  }
  const ensembleTake = weightedTake >= 0.5;
  const agreement = Math.abs(weightedTake - 0.5) * 2; // 0=split, 1=unanimous
  const finalConf = Number(weightedConf.toFixed(3));
  const riskLevel = finalConf < 0.4 ? 'high' : finalConf < 0.6 ? 'medium' : 'low';

  // Track each LLM opinion for learning
  state.forex_llm_log = state.forex_llm_log || [];
  for (const [name, op] of Object.entries(opinions)) {
    state.forex_llm_log.unshift({
      time: new Date().toISOString(), symbol: signal.symbol, direction: signal.direction,
      llm_take: op.take_trade, llm_conf: op.adjusted_confidence, llm_dir: op.direction,
      provider: name, entry_price: signal.current_price, outcome: null, resolved: false,
    });
  }
  state.forex_llm_log = state.forex_llm_log.slice(0, 200);

  return {
    opinion: {
      take_trade: ensembleTake,
      adjusted_confidence: finalConf,
      direction: ensembleTake ? signal.direction : 'WAIT',
      reason: `Ensemble (${Object.keys(opinions).length} LLMs, ${(agreement*100).toFixed(0)}% agreement): ${reasons[0] || 'see details'}`,
      risk_level: riskLevel,
    },
    providers_used: Object.keys(opinions),
    individual_opinions: opinions,
    agreement_pct: Number((agreement * 100).toFixed(0)),
    all_reasons: reasons,
    errors,
  };
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
      let currentPrice = candles[candles.length - 1]?.close;
      if (!currentPrice) { trade.status = 'ERROR'; trade.result = 'ERROR'; continue; }

      // Simulate spread — exit price is worse than raw price
      // For CALL: you SELL at exit → bid price (lower)
      // For PUT:  you effectively "buy back" → ask price (higher)
      if (cfg.forex_simulate_spread) {
        const spreadPips = Number(cfg.forex_spread_pips || 1.5);
        const pipSize = trade.symbol?.includes('JPY') ? 0.01 : 0.0001;
        const spreadCost = spreadPips * pipSize;
        if (trade.direction === 'CALL') currentPrice -= spreadCost;
        else currentPrice += spreadCost;
        trade.spread_applied_pips = spreadPips;
      }

      trade.exit_price = currentPrice;

      // Determine win/loss (now against spread-adjusted exit)
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
        state.forex_bankroll = Number((state.forex_bankroll + trade.amount).toFixed(2));
      } else {
        trade.pnl = -trade.amount;
      }

      trade.status = 'CLOSED';
      resolved++;
      pushLiveComm('forex_trade_resolved', { symbol: trade.symbol, direction: trade.direction, result: trade.result, pnl: trade.pnl });
      try { const { logNewsImpactForTrade } = await import('./learningEngine.js'); logNewsImpactForTrade(state, trade); } catch (e) { pushLiveComm('news_impact_log_error', { symbol: trade.symbol, error: e.message }); }
    } catch (e) {
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

// Wilson score confidence interval — robust for small samples
// Returns [lower, upper] bounds for 95% confidence
function wilsonInterval(wins, total) {
  if (total === 0) return [0, 0];
  const z = 1.96; // 95% confidence
  const p = wins / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = z * Math.sqrt((p * (1 - p) / total) + z2 / (4 * total * total)) / denom;
  return [Math.max(0, (center - margin) * 100), Math.min(100, (center + margin) * 100)];
}

// Significance classification based on trade count
function getSignificance(total) {
  if (total < 10) return { level: 'very_low', label: 'sehr gering', confidence: '±25%' };
  if (total < 20) return { level: 'low', label: 'gering', confidence: '±15%' };
  if (total < 30) return { level: 'moderate', label: 'moderat', confidence: '±10%' };
  if (total < 50) return { level: 'good', label: 'gut', confidence: '±7%' };
  return { level: 'high', label: 'hoch', confidence: '±5%' };
}

export function analyzeForexLearning(state) {
  const binaryClosed = (state.forex_trades || []).filter(t => t.status === 'CLOSED' && t.result);
  const proClosed = (state.forex_pro_trades || []).filter(t => t.status === 'CLOSED' && t.result);
  const allClosed = [...binaryClosed, ...proClosed];

  // Cold-start: first 5 trades use HALF size (exploring)
  const coldStartActive = allClosed.length < 5;

  if (allClosed.length < 3) return {
    ready: false, min_trades: 3, current: allClosed.length, insights: [],
    cold_start: true, cold_start_size_factor: 0.5,
    cold_start_msg: `Cold-Start Phase: erste ${allClosed.length}/5 Trades. Einsätze werden auf 50% reduziert bis 5+ Trades vorliegen.`,
  };

  const insights = [];

  // ═══ 1. Performance by pair ═══
  const byPair = {};
  for (const t of allClosed) {
    const key = t.symbol || 'unknown';
    if (!byPair[key]) byPair[key] = { wins: 0, losses: 0, pnl: 0, binary: { w: 0, l: 0 }, pro: { w: 0, l: 0 } };
    const bucket = t.type === 'PRO' ? byPair[key].pro : byPair[key].binary;
    if (t.result === 'WIN') { byPair[key].wins++; bucket.w++; }
    else if (t.result === 'LOSS') { byPair[key].losses++; bucket.l++; }
    byPair[key].pnl += Number(t.pnl || 0);
  }
  const pairStats = Object.entries(byPair).map(([pair, s]) => {
    const total = s.wins + s.losses;
    const ci = wilsonInterval(s.wins, total);
    const sig = getSignificance(total);
    return {
      pair, total, wins: s.wins, losses: s.losses,
      win_rate: total > 0 ? Number((s.wins / total * 100).toFixed(1)) : 0,
      wr_ci_lower: Number(ci[0].toFixed(1)),
      wr_ci_upper: Number(ci[1].toFixed(1)),
      significance: sig.level,
      significance_label: sig.label,
      pnl: Number(s.pnl.toFixed(2)),
      binary_wr: s.binary.w + s.binary.l > 0 ? Number((s.binary.w / (s.binary.w + s.binary.l) * 100).toFixed(0)) : null,
      pro_wr: s.pro.w + s.pro.l > 0 ? Number((s.pro.w / (s.pro.w + s.pro.l) * 100).toFixed(0)) : null,
    };
  }).sort((a, b) => b.win_rate - a.win_rate);

  // ═══ 2. Performance by timeframe ═══
  const byDuration = {};
  for (const t of binaryClosed) {
    const key = `${t.duration_min || '?'}min`;
    if (!byDuration[key]) byDuration[key] = { wins: 0, losses: 0, pnl: 0 };
    if (t.result === 'WIN') byDuration[key].wins++; else if (t.result === 'LOSS') byDuration[key].losses++;
    byDuration[key].pnl += Number(t.pnl || 0);
  }
  const durationStats = Object.entries(byDuration).map(([dur, s]) => ({
    duration: dur, total: s.wins + s.losses, wins: s.wins,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
    pnl: Number(s.pnl.toFixed(2)),
  })).sort((a, b) => b.win_rate - a.win_rate);

  // ═══ 3. Performance by direction ═══
  const byDir = { CALL: { wins: 0, losses: 0, pnl: 0 }, PUT: { wins: 0, losses: 0, pnl: 0 } };
  for (const t of allClosed) {
    const d = byDir[t.direction] || byDir.CALL;
    if (t.result === 'WIN') d.wins++; else if (t.result === 'LOSS') d.losses++;
    d.pnl += Number(t.pnl || 0);
  }
  const dirStats = Object.entries(byDir).map(([dir, s]) => ({
    direction: dir, total: s.wins + s.losses, wins: s.wins,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
    pnl: Number(s.pnl.toFixed(2)),
  }));

  // ═══ 4. Performance by signal strength ═══
  const byStrength = {};
  for (const t of allClosed) {
    const key = t.signal_strength || 'UNKNOWN';
    if (!byStrength[key]) byStrength[key] = { wins: 0, losses: 0 };
    if (t.result === 'WIN') byStrength[key].wins++; else if (t.result === 'LOSS') byStrength[key].losses++;
  }
  const strengthStats = Object.entries(byStrength).map(([str, s]) => ({
    strength: str, total: s.wins + s.losses, wins: s.wins,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.win_rate - a.win_rate);

  // ═══ 5. Performance by hour ═══
  const byHour = {};
  for (const t of allClosed) {
    const h = t.hour ?? new Date(t.opened_at).getUTCHours();
    if (!byHour[h]) byHour[h] = { wins: 0, losses: 0 };
    if (t.result === 'WIN') byHour[h].wins++; else if (t.result === 'LOSS') byHour[h].losses++;
  }
  const hourStats = Object.entries(byHour).map(([h, s]) => ({
    hour: Number(h), total: s.wins + s.losses, wins: s.wins,
    win_rate: s.wins + s.losses > 0 ? Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.win_rate - a.win_rate);

  // ═══ 6. Single indicator accuracy ═══
  const byIndicator = {};
  for (const t of allClosed) {
    for (const [name, ind] of Object.entries(t.indicators || {})) {
      if (!byIndicator[name]) byIndicator[name] = { correct: 0, wrong: 0, neutral: 0 };
      const indSaysUp = ind.score > 0.2;
      const indSaysDown = ind.score < -0.2;
      const tradeWon = t.result === 'WIN';
      if ((t.direction === 'CALL' && indSaysUp && tradeWon) || (t.direction === 'PUT' && indSaysDown && tradeWon)) byIndicator[name].correct++;
      else if ((t.direction === 'CALL' && indSaysUp && !tradeWon) || (t.direction === 'PUT' && indSaysDown && !tradeWon)) byIndicator[name].wrong++;
      else byIndicator[name].neutral++;
    }
  }
  const indicatorStats = Object.entries(byIndicator)
    .filter(([, s]) => s.correct + s.wrong >= 3)
    .map(([name, s]) => ({
      indicator: name, total: s.correct + s.wrong, correct: s.correct,
      accuracy: s.correct + s.wrong > 0 ? Number((s.correct / (s.correct + s.wrong) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.accuracy - a.accuracy);

  // ═══ 7. INDICATOR COMBINATIONS — which combos work together? ═══
  const combos = {};
  for (const t of allClosed) {
    const inds = Object.entries(t.indicators || {}).filter(([, v]) => Math.abs(v.score) > 0.2);
    if (inds.length < 2) continue;
    // Track all pairs of indicators that agreed
    const agreeing = inds.filter(([, v]) => (t.direction === 'CALL' && v.score > 0.2) || (t.direction === 'PUT' && v.score < -0.2));
    if (agreeing.length >= 2) {
      const comboKey = agreeing.map(([n]) => n).sort().join('+');
      if (!combos[comboKey]) combos[comboKey] = { wins: 0, losses: 0 };
      if (t.result === 'WIN') combos[comboKey].wins++; else combos[comboKey].losses++;
    }
  }
  const comboStats = Object.entries(combos)
    .filter(([, s]) => s.wins + s.losses >= 3)
    .map(([combo, s]) => ({
      combo, total: s.wins + s.losses, wins: s.wins,
      win_rate: Number((s.wins / (s.wins + s.losses) * 100).toFixed(1)),
    })).sort((a, b) => b.win_rate - a.win_rate);

  // ═══ 8. STREAKS — current winning/losing streak ═══
  const recent = allClosed.slice(0, 20);
  let streak = 0, streakType = null;
  for (const t of recent) {
    if (!streakType) { streakType = t.result; streak = 1; }
    else if (t.result === streakType) streak++;
    else break;
  }

  // ═══ 9. LLM OPINION TRACKING ═══
  const llmLog = state.forex_llm_log || [];
  const llmCorrect = llmLog.filter(l => l.outcome === 'CORRECT').length;
  const llmWrong = llmLog.filter(l => l.outcome === 'WRONG').length;
  const llmAccuracy = llmCorrect + llmWrong > 0 ? Number((llmCorrect / (llmCorrect + llmWrong) * 100).toFixed(1)) : null;

  // ═══ 10. SELF-OPTIMIZATION SUGGESTIONS ═══
  const suggestions = [];
  const overallWR = allClosed.length ? Number((allClosed.filter(t => t.result === 'WIN').length / allClosed.length * 100).toFixed(1)) : 0;

  if (overallWR < 48 && allClosed.length >= 20) suggestions.push({ type: 'warning', msg: `Win Rate ${overallWR}% — unter break-even. Nur STRONG Signale traden.` });
  if (strengthStats.find(s => s.strength === 'WEAK' && s.total >= 10 && s.win_rate < 45)) suggestions.push({ type: 'action', msg: 'WEAK Signale haben <45% WR (10+ Trades). Empfehlung: WEAK ignorieren.' });
  if (strengthStats.find(s => s.strength === 'STRONG' && s.total >= 10 && s.win_rate >= 60)) suggestions.push({ type: 'positive', msg: 'STRONG Signale >60% WR (10+ Trades). Einsatz bei STRONG erhöhen.' });

  const worstPair = pairStats.find(p => p.total >= 10 && p.wr_ci_upper < 48);
  if (worstPair) suggestions.push({ type: 'action', msg: `${worstPair.pair}: ${worstPair.win_rate}% WR bei ${worstPair.total} Trades (CI ${worstPair.wr_ci_lower}-${worstPair.wr_ci_upper}%). Aus Watchlist entfernen.` });

  const bestCombo = comboStats[0];
  const worstCombo = comboStats[comboStats.length - 1];
  if (bestCombo && bestCombo.win_rate >= 60 && bestCombo.total >= 10) suggestions.push({ type: 'positive', msg: `Beste Kombi: ${bestCombo.combo} (${bestCombo.win_rate}% WR, ${bestCombo.total}T). Bevorzugen.` });
  if (worstCombo && worstCombo.win_rate < 40 && worstCombo.total >= 10) suggestions.push({ type: 'warning', msg: `Schlechteste Kombi: ${worstCombo.combo} (${worstCombo.win_rate}%, ${worstCombo.total}T). Meiden!` });

  if (streak >= 3 && streakType === 'LOSS') suggestions.push({ type: 'warning', msg: `${streak} Verluste in Folge. Pause oder Einsatz reduzieren.` });
  if (llmAccuracy != null && llmAccuracy < 45 && llmCorrect + llmWrong >= 10) suggestions.push({ type: 'warning', msg: `LLM nur ${llmAccuracy}% korrekt (${llmCorrect + llmWrong}×). Weniger auf KI verlassen.` });
  if (llmAccuracy != null && llmAccuracy >= 60 && llmCorrect + llmWrong >= 10) suggestions.push({ type: 'positive', msg: `LLM ${llmAccuracy}% korrekt (${llmCorrect + llmWrong}×). KI-Empfehlungen stärker gewichten.` });

  // Insights — only show when statistically meaningful (10+ trades, or CI excludes 50%)
  const sigBestPair = pairStats.find(p => p.total >= 10 && p.wr_ci_lower > 50);
  if (sigBestPair) insights.push(`✅ ${sigBestPair.pair}: ${sigBestPair.win_rate}% WR (${sigBestPair.total}T, 95%-CI ${sigBestPair.wr_ci_lower}-${sigBestPair.wr_ci_upper}%)`);
  else {
    const tentativeBest = pairStats.find(p => p.total >= 5 && p.win_rate >= 55);
    if (tentativeBest) insights.push(`📊 ${tentativeBest.pair}: ${tentativeBest.win_rate}% WR (${tentativeBest.total}T) — ${tentativeBest.significance_label}e Signifikanz, mehr Daten sammeln`);
  }
  const sigWorstPair = pairStats.find(p => p.total >= 10 && p.wr_ci_upper < 50);
  if (sigWorstPair) insights.push(`❌ ${sigWorstPair.pair}: ${sigWorstPair.win_rate}% WR (95%-CI ${sigWorstPair.wr_ci_lower}-${sigWorstPair.wr_ci_upper}%) — meiden!`);
  const bestDur = durationStats.find(d => d.total >= 10 && d.win_rate >= 55);
  if (bestDur) insights.push(`✅ ${bestDur.duration} Trades: ${bestDur.win_rate}% WR`);
  const bestInd = indicatorStats.find(i => i.accuracy >= 60 && i.total >= 10);
  const worstInd = indicatorStats.find(i => i.accuracy < 40 && i.total >= 10);
  if (bestInd) insights.push(`✅ ${bestInd.indicator.toUpperCase()}: ${bestInd.accuracy}% (signifikant)`);
  if (worstInd) insights.push(`❌ ${worstInd.indicator.toUpperCase()}: ${worstInd.accuracy}% (signifikant schlecht)`);
  const bestHour = hourStats.find(h => h.total >= 10 && h.win_rate >= 60);
  if (bestHour) insights.push(`✅ Beste Zeit: ${bestHour.hour}:00 UTC (${bestHour.win_rate}% WR)`);
  if (bestCombo && bestCombo.total >= 10) insights.push(`✅ Beste Kombi: ${bestCombo.combo} (${bestCombo.win_rate}% WR, ${bestCombo.total}T)`);
  if (streak >= 3) insights.push(`${streakType === 'WIN' ? '🔥' : '❄️'} ${streak}er ${streakType}-Serie`);

  return {
    ready: true,
    total_trades: allClosed.length,
    binary_trades: binaryClosed.length,
    pro_trades: proClosed.length,
    overall_win_rate: overallWR,
    cold_start: coldStartActive,
    cold_start_size_factor: coldStartActive ? 0.5 : 1.0,
    cold_start_msg: coldStartActive ? `Cold-Start Phase aktiv (${allClosed.length}/5). Einsätze bleiben auf 50% reduziert.` : null,
    statistically_significant: allClosed.length >= 30,
    significance_msg: allClosed.length < 30 ? `Nur ${allClosed.length} Trades — statistisch nicht signifikant (30+ empfohlen). Werte können zufällig sein.` : `${allClosed.length} Trades — statistisch signifikant.`,
    by_pair: pairStats, by_duration: durationStats, by_direction: dirStats,
    by_strength: strengthStats, by_hour: hourStats, by_indicator: indicatorStats,
    by_combo: comboStats,
    streak: { count: streak, type: streakType },
    llm_tracking: { accuracy: llmAccuracy, correct: llmCorrect, wrong: llmWrong, total: llmCorrect + llmWrong },
    suggestions,
    insights,
  };
}

// Build comprehensive LLM context from ALL learning data
export function buildForexLlmContext(state) {
  const learning = analyzeForexLearning(state);
  if (!learning.ready) return '';
  const signalAcc = (state.forex_signal_log || []).filter(l => l.resolved);
  const sigCorrect = signalAcc.filter(l => l.outcome === 'CORRECT').length;
  const currentHour = new Date().getUTCHours();

  const lines = [
    `\n═══ HISTORICAL PERFORMANCE (${learning.total_trades} trades: ${learning.binary_trades} binary + ${learning.pro_trades} pro) ═══`,
    `Win Rate: ${learning.overall_win_rate}%`,
  ];

  if (learning.by_pair.length) {
    lines.push('\nPAIR PERFORMANCE (weight heavily):');
    for (const p of learning.by_pair) {
      lines.push(`  ${p.pair}: ${p.win_rate}% WR (${p.total}T, ${p.pnl>=0?'+':''}$${p.pnl})${p.win_rate>=58?' ← STRONG':p.win_rate<45?' ← AVOID':''}`);
    }
  }
  if (learning.by_indicator.length) {
    lines.push('\nINDICATOR RELIABILITY:');
    for (const i of learning.by_indicator) {
      lines.push(`  ${i.indicator.toUpperCase()}: ${i.accuracy}% (${i.total} signals)${i.accuracy>=60?' ← RELIABLE':i.accuracy<40?' ← UNRELIABLE':''}`);
    }
  }
  if (learning.by_combo?.length) {
    lines.push('\nINDICATOR COMBOS:');
    for (const c of learning.by_combo.slice(0,4)) lines.push(`  ${c.combo}: ${c.win_rate}% WR (${c.total}T)${c.win_rate>=60?' ← BEST':''}${c.win_rate<40?' ← WORST':''}`);
  }
  if (learning.by_direction.length) {
    for (const d of learning.by_direction) { if (d.total>=3) lines.push(`${d.direction}: ${d.win_rate}% WR${d.win_rate<45?' ← WEAK':''}`); }
  }
  const hourData = learning.by_hour?.find(h => h.hour === currentHour);
  if (hourData && hourData.total >= 2) lines.push(`CURRENT HOUR ${currentHour}:00 UTC: ${hourData.win_rate}% WR (${hourData.total}T)`);
  if (learning.streak?.count >= 3) lines.push(`⚠ ${learning.streak.count}× ${learning.streak.type} streak${learning.streak.type==='LOSS'?' — REDUCE RISK':''}`);
  if (learning.llm_tracking?.total >= 3) lines.push(`YOUR PAST ACCURACY: ${learning.llm_tracking.accuracy}% (${learning.llm_tracking.total} opinions)${learning.llm_tracking.accuracy<50?' — too often WRONG':''}` );
  if (signalAcc.length >= 5) lines.push(`SIGNAL OBSERVER: ${sigCorrect}/${signalAcc.length} correct (${(sigCorrect/signalAcc.length*100).toFixed(0)}%)`);
  if (learning.suggestions?.length) {
    lines.push('\nRULES (follow these):');
    for (const s of learning.suggestions) lines.push(`  ${s.type==='warning'?'⚠':s.type==='action'?'🔧':'✅'} ${s.msg}`);
  }

  // News impact learning
  const newsTradeLog = state.forex_news_trade_log || [];
  if (newsTradeLog.length >= 5) {
    const correct = newsTradeLog.filter(l => l.outcome === 'CORRECT').length;
    const acc = Math.round(correct / newsTradeLog.length * 100);
    lines.push(`\nNEWS PREDICTIVE POWER: ${acc}% (${correct}/${newsTradeLog.length}) — ${acc >= 60 ? 'news IS useful' : acc < 40 ? 'news MISLEADING — weight less' : 'mixed'}`);
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════
// SMART RECOMMENDATIONS (uses learning + indicators)
// ═══════════════════════════════════════════

export function generateForexRecommendations(signals, state) {
  const cfg = state.config || {};
  const learning = analyzeForexLearning(state);
  const bankroll = state.forex_bankroll ?? Number(cfg.forex_bankroll || 100);
  const payoutPct = Number(cfg.forex_payout_pct || 85);
  const maxConcurrent = Number(cfg.forex_max_concurrent || 2);
  const openCount = (state.forex_trades || []).filter(t => t.status === 'OPEN').length;
  const slotsAvailable = maxConcurrent - openCount;

  const recommendations = [];

  for (const sig of signals) {
    if (sig.error || sig.direction === 'WAIT') continue;

    // Start with technical confidence
    let score = sig.confidence || 0;
    let reasons = [];
    let warnings = [];

    // Boost/penalize based on learning data
    if (learning.ready) {
      const pairData = learning.by_pair.find(p => p.pair === sig.symbol);
      if (pairData && pairData.total >= 3) {
        if (pairData.win_rate >= 58) {
          score += 0.15;
          reasons.push(`${sig.symbol} hat ${pairData.win_rate}% WR in ${pairData.total} Trades`);
        } else if (pairData.win_rate < 48) {
          score -= 0.2;
          warnings.push(`${sig.symbol} hat nur ${pairData.win_rate}% WR — schlecht!`);
        }
      }

      // Check best duration from learning
      const durData = learning.by_duration;
      if (durData.length && durData[0].win_rate >= 55) {
        reasons.push(`Beste Dauer: ${durData[0].duration} (${durData[0].win_rate}% WR)`);
      }

      // Check direction bias
      const dirData = learning.by_direction.find(d => d.direction === sig.direction);
      if (dirData && dirData.total >= 5) {
        if (dirData.win_rate >= 58) {
          score += 0.1;
          reasons.push(`${sig.direction} gewinnt ${dirData.win_rate}% der Zeit`);
        } else if (dirData.win_rate < 45) {
          score -= 0.15;
          warnings.push(`${sig.direction} gewinnt nur ${dirData.win_rate}%`);
        }
      }

      // Check indicator reliability
      for (const ind of learning.by_indicator) {
        if (ind.accuracy >= 60 && sig.indicators?.[ind.indicator]?.score) {
          const agrees = (sig.direction === 'CALL' && sig.indicators[ind.indicator].score > 0) || (sig.direction === 'PUT' && sig.indicators[ind.indicator].score < 0);
          if (agrees) {
            score += 0.05;
            reasons.push(`${ind.indicator.toUpperCase()} ist zuverlässig (${ind.accuracy}%) und bestätigt ${sig.direction}`);
          }
        }
        if (ind.accuracy < 40 && ind.total >= 5) {
          warnings.push(`${ind.indicator.toUpperCase()} ist unzuverlässig (${ind.accuracy}%)`);
        }
      }

      // Time of day factor
      const currentHour = new Date().getUTCHours();
      const hourData = learning.by_hour.find(h => h.hour === currentHour);
      if (hourData && hourData.total >= 3) {
        if (hourData.win_rate >= 60) {
          score += 0.1;
          reasons.push(`${currentHour}:00 UTC ist eine gute Stunde (${hourData.win_rate}% WR)`);
        } else if (hourData.win_rate < 40) {
          score -= 0.1;
          warnings.push(`${currentHour}:00 UTC hat schlechte WR (${hourData.win_rate}%)`);
        }
      }
    }

    // News-based scoring
    const newsData = state.forex_news;
    if (newsData?.currency_sentiment) {
      const parts = sig.symbol?.split('/') || [];
      if (parts.length === 2) {
        const [base, quote] = parts;
        const baseS = newsData.currency_sentiment[base];
        const quoteS = newsData.currency_sentiment[quote];
        if (baseS || quoteS) {
          const baseBias = baseS ? (baseS.bullish - baseS.bearish) : 0;
          const quoteBias = quoteS ? (quoteS.bullish - quoteS.bearish) : 0;
          const newsDirection = baseBias > quoteBias ? 'CALL' : quoteBias > baseBias ? 'PUT' : null;
          if (newsDirection && newsDirection === sig.direction) {
            score += 0.12;
            reasons.push(`📰 News unterstützen ${sig.direction} (${base}:${baseBias>0?'+':''}${baseBias} vs ${quote}:${quoteBias>0?'+':''}${quoteBias})`);
          } else if (newsDirection && newsDirection !== sig.direction) {
            score -= 0.1;
            warnings.push(`📰 News widersprechen ${sig.direction}! (${base}:${baseBias>0?'+':''}${baseBias} vs ${quote}:${quoteBias>0?'+':''}${quoteBias})`);
          }
          const baseHigh = baseS?.headlines?.some(h => h.impact === 'HIGH');
          const quoteHigh = quoteS?.headlines?.some(h => h.impact === 'HIGH');
          if (baseHigh || quoteHigh) warnings.push(`⚡ HIGH IMPACT News — erhöhte Volatilität!`);
        }
      }
    }

    // Determine recommended duration (from learning or default)
    let recDuration = Number(cfg.forex_default_duration || 3);
    if (learning.ready && learning.by_duration.length) {
      const bestDur = learning.by_duration.find(d => d.win_rate >= 55 && d.total >= 3);
      if (bestDur) recDuration = parseInt(bestDur.duration) || recDuration;
    }

    // Position sizing based on confidence (simple Kelly-like)
    const winProb = Math.min(0.8, Math.max(0.3, 0.5 + score * 0.3));
    const kellyPct = Math.max(0, (winProb * (payoutPct / 100) - (1 - winProb)) / (payoutPct / 100));
    const quarterKelly = kellyPct * 0.25;
    const coldStartFactor = learning.cold_start ? (learning.cold_start_size_factor || 0.5) : 1.0;
    const recAmount = Math.max(1, Math.min(bankroll * 0.1, Math.round(bankroll * quarterKelly * coldStartFactor)));
    if (learning.cold_start) reasons.push(`❄️ Cold-Start: Einsatz auf ${Math.round(coldStartFactor*100)}% reduziert (${learning.current || 0}/5 Trades)`);

    // Final recommendation
    const finalScore = Math.max(0, Math.min(1, score));
    const action = finalScore >= 0.5 ? 'TRADE' : finalScore >= 0.3 ? 'MAYBE' : 'SKIP';

    recommendations.push({
      symbol: sig.symbol,
      direction: sig.direction,
      action,
      score: Number(finalScore.toFixed(3)),
      confidence_pct: Number((finalScore * 100).toFixed(0)),
      recommended_amount: recAmount,
      recommended_duration: recDuration,
      max_amount: Math.round(bankroll * 0.1),
      signal_strength: sig.signal_strength,
      technical_confidence: sig.confidence,
      reasons,
      warnings,
      indicator_summary: Object.entries(sig.indicators || {}).map(([k, v]) => `${k}:${v.score > 0 ? '+' : ''}${v.score.toFixed(1)}`).join(' '),
      current_price: sig.current_price,
    });
  }

  // Sort by score, best first
  recommendations.sort((a, b) => b.score - a.score);

  return {
    time: new Date().toISOString(),
    bankroll,
    slots_available: slotsAvailable,
    recommendations,
    learning_active: learning.ready,
    overall_win_rate: learning.ready ? learning.overall_win_rate : null,
  };
}

// ═══════════════════════════════════════════
// AUTO-TRADING
// ═══════════════════════════════════════════

export async function runForexAutoTrade(state) {
  const cfg = state.config || {};
  if (!cfg.forex_auto_enabled) return { executed: 0, reason: 'auto_disabled' };

  const bankroll = state.forex_bankroll ?? Number(cfg.forex_bankroll || 100);
  if (bankroll < 2) return { executed: 0, reason: 'bankroll_too_low' };

  const maxConcurrent = Number(cfg.forex_max_concurrent || 2);
  const openCount = (state.forex_trades || []).filter(t => t.status === 'OPEN').length;
  if (openCount >= maxConcurrent) return { executed: 0, reason: 'max_concurrent_reached' };

  const minScore = Number(cfg.forex_auto_min_score || 0.5);

  // Scan fresh signals
  const scanResult = await scanForexSignals(null, cfg.forex_interval || '5min');
  state.forex_signals = scanResult;

  // Generate recommendations
  const recs = generateForexRecommendations(scanResult.signals, state);

  // Find best tradeable recommendation
  const tradeable = recs.recommendations.filter(r => r.action === 'TRADE' && r.score >= minScore);
  if (!tradeable.length) return { executed: 0, reason: 'no_strong_signals', scanned: scanResult.signals.length, best_score: recs.recommendations[0]?.score || 0 };

  // Execute top recommendation
  const best = tradeable[0];
  const signalData = scanResult.signals.find(s => s.symbol === best.symbol);

  // Fetch entry price
  const candles = await fetchCandleData(best.symbol, '1min', 3);
  const entryPrice = candles[candles.length - 1]?.close;
  if (!entryPrice) return { executed: 0, reason: 'no_entry_price' };

  const result = openForexPaperTrade(state, {
    symbol: best.symbol,
    direction: best.direction,
    duration_min: best.recommended_duration,
    amount: best.recommended_amount,
    signal_data: signalData,
  });

  if (!result.ok) return { executed: 0, reason: result.error };
  result.trade.entry_price = entryPrice;

  pushLiveComm('forex_auto_trade', {
    symbol: best.symbol, direction: best.direction,
    amount: best.recommended_amount, duration: best.recommended_duration,
    score: best.score, entry: entryPrice,
  });

  return {
    executed: 1,
    trade: result.trade,
    recommendation: best,
    bankroll: state.forex_bankroll,
  };
}

// ═══════════════════════════════════════════════════════════════
// FOREX PRO — Stop-Loss / Take-Profit System (realistisches Trading)
// ═══════════════════════════════════════════════════════════════
// Statt Binary Options (alles oder nichts) arbeitet dieses System mit:
// - Stop-Loss: Maximaler Verlust pro Trade (z.B. 20 Pips)
// - Take-Profit: Gewinnziel (z.B. 30 Pips)
// - Risk:Reward Ratio (z.B. 1:1.5 → für jeden $1 Risiko, $1.50 Gewinn)
// - Position Sizing: Riskiere nur X% der Bankroll pro Trade

export function openForexProTrade(state, { symbol, direction, sl_pips, tp_pips, risk_pct, entry_price, signal_data }) {
  const cfg = state.config || {};
  state.forex_pro_trades = state.forex_pro_trades || [];
  state.forex_pro_bankroll = state.forex_pro_bankroll ?? Number(cfg.forex_pro_bankroll || 1000);

  const bankroll = state.forex_pro_bankroll;
  if (bankroll < 10) return { ok: false, error: `Bankroll zu niedrig ($${bankroll})` };

  const maxConcurrent = Number(cfg.forex_pro_max_concurrent || 3);
  const openTrades = state.forex_pro_trades.filter(t => t.status === 'OPEN');
  if (openTrades.length >= maxConcurrent) return { ok: false, error: `Max ${maxConcurrent} gleichzeitige Trades (${openTrades.length} offen)` };

  // Currency correlation check: warn if same currency is already exposed
  if (cfg.forex_correlation_check !== false) {
    const [base, quote] = (symbol || '').split('/');
    for (const t of openTrades) {
      const [oBase, oQuote] = (t.symbol || '').split('/');
      // Same base + same direction = double exposure to base currency
      // Same quote + opposite direction = double exposure to quote currency
      const shareBase = base === oBase;
      const shareQuote = quote === oQuote;
      const shareBaseQuote = base === oQuote || quote === oBase;
      if ((shareBase && t.direction === direction) ||
          (shareQuote && t.direction !== direction) ||
          (shareBaseQuote && t.direction === direction)) {
        return { ok: false, error: `Correlation-Block: ${symbol} ${direction} würde Exposure von offenem ${t.symbol} ${t.direction} verdoppeln. Zuerst schließen oder in Einstellungen deaktivieren.` };
      }
    }
  }

  // Position sizing based on risk
  const riskPercent = Math.min(0.05, Math.max(0.005, Number(risk_pct || cfg.forex_pro_risk_pct || 0.02)));
  const riskAmount = bankroll * riskPercent;
  const slPips = Number(sl_pips || cfg.forex_pro_default_sl || 20);
  const tpPips = Number(tp_pips || cfg.forex_pro_default_tp || 30);
  const pipValue = symbol.includes('JPY') ? 0.01 : 0.0001;

  // Apply entry spread + slippage — realistic simulation
  let actualEntryPrice = entry_price;
  if (cfg.forex_simulate_spread) {
    const spreadPips = Number(cfg.forex_spread_pips || 1.5);
    const slippagePips = Number(cfg.forex_slippage_pips || 0.5);
    const totalCost = (spreadPips + slippagePips) * pipValue;
    // Entry is always worse than signal price — when buying you pay ask, when selling you get bid
    actualEntryPrice = direction === 'CALL' ? entry_price + totalCost : entry_price - totalCost;
  }

  // Calculate SL and TP prices FROM actual entry (not raw signal)
  const slPrice = direction === 'CALL'
    ? actualEntryPrice - (slPips * pipValue)
    : actualEntryPrice + (slPips * pipValue);
  const tpPrice = direction === 'CALL'
    ? actualEntryPrice + (tpPips * pipValue)
    : actualEntryPrice - (tpPips * pipValue);

  const riskReward = tpPips / slPips;

  // Extract indicator snapshot
  const indicators = {};
  if (signal_data?.indicators) {
    for (const [name, ind] of Object.entries(signal_data.indicators)) {
      indicators[name] = { score: ind.score };
    }
  }

  const trade = {
    id: 'fp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: 'PRO',
    symbol, direction,
    entry_price: Number(actualEntryPrice.toFixed(6)),
    signal_price: Number(entry_price.toFixed(6)),
    spread_pips_applied: cfg.forex_simulate_spread ? Number(cfg.forex_spread_pips || 1.5) : 0,
    slippage_pips_applied: cfg.forex_simulate_spread ? Number(cfg.forex_slippage_pips || 0.5) : 0,
    stop_loss: Number(slPrice.toFixed(6)),
    take_profit: Number(tpPrice.toFixed(6)),
    sl_pips: slPips,
    tp_pips: tpPips,
    risk_reward: Number(riskReward.toFixed(2)),
    risk_amount: Number(riskAmount.toFixed(2)),
    risk_pct: Number((riskPercent * 100).toFixed(1)),
    status: 'OPEN',
    result: null,
    pnl: 0,
    opened_at: new Date().toISOString(),
    closed_at: null,
    current_price: actualEntryPrice,
    current_pnl_pips: 0,
    // Learning data
    confidence: signal_data?.confidence || 0,
    signal_strength: signal_data?.signal_strength || 'NONE',
    avg_score: signal_data?.avg_score || 0,
    indicators,
    patterns: (signal_data?.patterns || []).map(p => p.name || p),
    hour: new Date().getUTCHours(),
    interval: signal_data?.interval || cfg.forex_interval || '5min',
  };

  state.forex_pro_bankroll -= riskAmount; // Reserve risk amount
  state.forex_pro_trades.unshift(trade);
  return { ok: true, trade };
}

export async function resolveForexProTrades(state) {
  state.forex_pro_trades = state.forex_pro_trades || [];
  let resolved = 0;

  const openTrades = state.forex_pro_trades.filter(t => t.status === 'OPEN');
  if (!openTrades.length) return 0;

  // Group by symbol to minimize API calls
  const symbols = [...new Set(openTrades.map(t => t.symbol))];

  for (const symbol of symbols) {
    try {
      const candles = await fetchCandleData(symbol, '1min', 3);
      const currentPrice = candles[candles.length - 1]?.close;
      const highPrice = Math.max(...candles.map(c => c.high));
      const lowPrice = Math.min(...candles.map(c => c.low));
      if (!currentPrice) continue;

      for (const trade of openTrades.filter(t => t.symbol === symbol)) {
        trade.current_price = currentPrice;
        const pipValue = symbol.includes('JPY') ? 0.01 : 0.0001;
        trade.current_pnl_pips = trade.direction === 'CALL'
          ? Math.round((currentPrice - trade.entry_price) / pipValue)
          : Math.round((trade.entry_price - currentPrice) / pipValue);

        // Check if SL or TP was hit (using high/low for more realistic fills)
        let hit = null;
        if (trade.direction === 'CALL') {
          if (lowPrice <= trade.stop_loss) hit = 'LOSS';
          else if (highPrice >= trade.take_profit) hit = 'WIN';
        } else {
          if (highPrice >= trade.stop_loss) hit = 'LOSS';
          else if (lowPrice <= trade.take_profit) hit = 'WIN';
        }

        if (hit) {
          trade.result = hit;
          trade.status = 'CLOSED';
          trade.closed_at = new Date().toISOString();
          trade.exit_price = hit === 'WIN' ? trade.take_profit : trade.stop_loss;

          if (hit === 'WIN') {
            const pnlPips = trade.tp_pips;
            trade.pnl = Number((trade.risk_amount * trade.risk_reward).toFixed(2));
            trade.current_pnl_pips = pnlPips;
            // Return risk + profit (risk was deducted on open)
            state.forex_pro_bankroll = Number((state.forex_pro_bankroll + trade.risk_amount + trade.pnl).toFixed(2));
          } else {
            trade.pnl = -trade.risk_amount;
            trade.current_pnl_pips = -trade.sl_pips;
            // Risk was already deducted on open, nothing to return
          }
          resolved++;
          pushLiveComm('forex_pro_resolved', { symbol, direction: trade.direction, result: hit, pnl: trade.pnl, pips: trade.current_pnl_pips });
          try { const { logNewsImpactForTrade } = await import('./learningEngine.js'); logNewsImpactForTrade(state, trade); } catch {}
        }
      }
    } catch (e) {
      pushLiveComm('forex_pro_error', { symbol, error: e.message });
    }
  }
  return resolved;
}

export function closeForexProTrade(state, tradeId) {
  const trade = (state.forex_pro_trades || []).find(t => t.id === tradeId && t.status === 'OPEN');
  if (!trade) return { ok: false, error: 'Trade nicht gefunden oder bereits geschlossen' };

  const pipValue = trade.symbol.includes('JPY') ? 0.01 : 0.0001;
  const pnlPips = trade.direction === 'CALL'
    ? (trade.current_price - trade.entry_price) / pipValue
    : (trade.entry_price - trade.current_price) / pipValue;

  // PnL proportional to pips gained vs SL distance
  trade.pnl = Number((trade.risk_amount * (pnlPips / trade.sl_pips)).toFixed(2));
  trade.result = trade.pnl >= 0 ? 'WIN' : 'LOSS';
  trade.status = 'CLOSED';
  trade.closed_at = new Date().toISOString();
  trade.exit_price = trade.current_price;
  trade.current_pnl_pips = Math.round(pnlPips);

  // Return reserved risk + pnl (risk was deducted on open)
  const returnAmount = Math.max(0, trade.risk_amount + trade.pnl);
  state.forex_pro_bankroll = Number((state.forex_pro_bankroll + returnAmount).toFixed(2));
  return { ok: true, trade };
}

export function getForexProStats(state) {
  const cfg = state.config || {};
  const trades = (state.forex_pro_trades || []).filter(t => t.status === 'CLOSED');
  const open = (state.forex_pro_trades || []).filter(t => t.status === 'OPEN');
  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');
  const totalPnl = trades.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const grossProfit = wins.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.pnl || 0), 0));
  const startBankroll = Number(cfg.forex_pro_bankroll || 1000);
  const bankroll = state.forex_pro_bankroll ?? startBankroll;

  // Average RR achieved
  const avgRR = wins.length ? (wins.reduce((s, t) => s + (t.risk_reward || 1), 0) / wins.length) : 0;

  return {
    bankroll: Number(bankroll.toFixed(2)),
    starting_bankroll: startBankroll,
    total_pnl: Number(totalPnl.toFixed(2)),
    pnl_pct: startBankroll > 0 ? Number((totalPnl / startBankroll * 100).toFixed(1)) : 0,
    total_trades: trades.length,
    open_trades: open.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: trades.length ? Number((wins.length / trades.length * 100).toFixed(1)) : 0,
    profit_factor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : 0,
    avg_risk_reward: Number(avgRR.toFixed(2)),
    breakeven_rate: avgRR > 0 ? Number((100 / (1 + avgRR)).toFixed(0)) : 50,
    open: open.map(t => ({
      ...t,
      pnl_color: t.current_pnl_pips > 0 ? 'green' : t.current_pnl_pips < 0 ? 'red' : 'neutral',
    })),
  };
}

// Smart recommendations for Pro mode
export function generateForexProRecommendations(signals, state) {
  const cfg = state.config || {};
  const bankroll = state.forex_pro_bankroll ?? Number(cfg.forex_pro_bankroll || 1000);
  const riskPct = Number(cfg.forex_pro_risk_pct || 0.02);
  const defaultSL = Number(cfg.forex_pro_default_sl || 20);
  const defaultTP = Number(cfg.forex_pro_default_tp || 30);
  const learning = analyzeForexLearning(state); // Reuse learning from binary trades too

  const recommendations = [];

  for (const sig of signals) {
    if (sig.error || sig.direction === 'WAIT') continue;

    // ATR-based SL/TP
    let slPips = defaultSL;
    let tpPips = defaultTP;
    if (sig.atr) {
      const pipValue = sig.symbol?.includes('JPY') ? 0.01 : 0.0001;
      const atrPips = Math.round(sig.atr / pipValue);
      slPips = Math.max(10, Math.round(atrPips * 1.5)); // 1.5x ATR for SL
      tpPips = Math.max(15, Math.round(atrPips * 2.5)); // 2.5x ATR for TP (1:1.67 RR)
    }

    const rr = tpPips / slPips;
    const breakevenWR = 100 / (1 + rr);
    const riskAmount = Math.round(bankroll * riskPct);
    const score = sig.confidence || 0;

    recommendations.push({
      symbol: sig.symbol,
      direction: sig.direction,
      action: score >= 0.45 ? 'TRADE' : score >= 0.25 ? 'MAYBE' : 'SKIP',
      score: Number(score.toFixed(3)),
      sl_pips: slPips,
      tp_pips: tpPips,
      risk_reward: Number(rr.toFixed(2)),
      breakeven_wr: Number(breakevenWR.toFixed(0)),
      risk_amount: riskAmount,
      risk_pct: Number((riskPct * 100).toFixed(1)),
      current_price: sig.current_price,
      signal_strength: sig.signal_strength,
      indicator_summary: Object.entries(sig.indicators || {}).map(([k, v]) => `${k}:${v.score > 0 ? '+' : ''}${v.score.toFixed(1)}`).join(' '),
    });
  }

  recommendations.sort((a, b) => b.score - a.score);
  return { time: new Date().toISOString(), bankroll, recommendations };
}

// ═══════════════════════════════════════════════════════════════
// FOREX NEWS INTELLIGENCE — Internet-basierte Analyse
// ═══════════════════════════════════════════════════════════════

const CURRENCY_KEYWORDS = {
  USD: ['federal reserve','fed rate','fomc','us economy','us jobs','nonfarm','us inflation','cpi','us gdp','treasury','dollar','greenback','powell','us unemployment','jobless claims'],
  EUR: ['ecb','european central bank','eurozone','eu economy','lagarde','euro inflation','eu gdp','german','france economy','eu trade'],
  GBP: ['bank of england','boe','uk economy','uk inflation','british pound','sterling','uk gdp','uk jobs','sunak','bailey'],
  JPY: ['bank of japan','boj','japan economy','yen','ueda','japan inflation','japan gdp','nikkei','japan trade'],
  AUD: ['reserve bank australia','rba','australian economy','australia gdp','iron ore','china trade','commodity prices','australia jobs'],
  CHF: ['swiss national bank','snb','swiss franc','switzerland economy'],
  CAD: ['bank of canada','boc','canadian economy','oil prices','canada jobs','canada gdp','loonie'],
  NZD: ['reserve bank new zealand','rbnz','new zealand economy','kiwi dollar','dairy prices'],
};

const HIGH_IMPACT_EVENTS = [
  'rate decision','interest rate','rate cut','rate hike','rate hold',
  'nonfarm payroll','nfp','jobs report','employment',
  'cpi','inflation data','consumer price',
  'gdp','gross domestic','economic growth',
  'trade balance','trade war','tariff',
  'central bank','monetary policy','quantitative',
  'geopolitical','war','conflict','sanction',
];

const FOREX_RSS_FEEDS = [
  'https://www.forexlive.com/feed',
  'https://www.fxstreet.com/rss',
  'https://www.dailyfx.com/feeds/all',
  'https://feeds.reuters.com/reuters/businessNews',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
];

export async function fetchForexNews(cfg = {}, opts = {}) {
  const { fetchWithRetry, parseRssItems, sentimentFromText } = await import('./utils.js');
  const feeds = FOREX_RSS_FEEDS;
  const headlines = [];
  const errors = [];
  const feedStats = {};

  // ADAPTIVE DECISION: should we fetch article bodies?
  // Auto-triggers:
  // 1. User explicitly requested (opts.fetchBodies === true)
  // 2. HIGH IMPACT keywords detected in headlines
  // 3. Bot has LEARNED that certain sources have bad headline quality → always fetch body
  // 4. Recent high-impact market movement (>1% change) → fetch for context
  // 5. Never if already fetched in last 5 minutes
  const state = opts.state || null;
  const lastFetchWithBodies = state?.forex_news?.bodies_fetched_at ? new Date(state.forex_news.bodies_fetched_at).getTime() : 0;
  const recentlyFetched = Date.now() - lastFetchWithBodies < 5 * 60 * 1000;

  for (const feed of feeds.slice(0, 6)) {
    const feedName = feed.split('/').slice(2, 3)[0].replace('www.', '');
    try {
      const resp = await fetchWithRetry(feed, {}, { label: 'forex-news', retries: 1, timeoutMs: 8000, silent: true });
      const xml = await resp.text();
      const items = parseRssItems(xml).slice(0, 15);
      feedStats[feedName] = { ok: true, count: items.length };
      for (const item of items) {
        const description = item.description || item.summary || '';
        headlines.push({
          title: item.title, link: item.link, published: item.published_at,
          source: feedName, source_type: 'rss',
          description: String(description).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300),
        });
      }
    } catch (e) {
      feedStats[feedName] = { ok: false, error: e.message.slice(0, 60) };
      errors.push({ feed: feedName, error: e.message });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Match headlines to currencies
  const matched = headlines.map(h => {
    const searchText = ((h.title || '') + ' ' + (h.description || '')).toLowerCase();
    const titleLower = (h.title || '').toLowerCase();
    const currencies = [];
    for (const [ccy, keywords] of Object.entries(CURRENCY_KEYWORDS)) {
      if (keywords.some(kw => searchText.includes(kw))) currencies.push(ccy);
    }
    const isHighImpact = HIGH_IMPACT_EVENTS.some(evt => titleLower.includes(evt));
    const sentiment = sentimentFromText(searchText);
    return { ...h, currencies, is_high_impact: isHighImpact, sentiment, relevant: currencies.length > 0 || isHighImpact };
  }).filter(h => h.relevant);

  // ADAPTIVE AUTO-DECISION — should we fetch bodies?
  const highImpactCount = matched.filter(h => h.is_high_impact).length;
  const sourceFetchScore = state?.source_body_fetch_score || {};
  const autoFetch =
    opts.fetchBodies === true ||  // explicit request
    (highImpactCount > 0 && !recentlyFetched) ||  // HIGH IMPACT found
    (matched.length < 3 && !recentlyFetched);    // too few headlines → need more context

  const fetchDecision = { auto_fetch: autoFetch, reason: null };
  if (opts.fetchBodies === true) fetchDecision.reason = 'user_requested';
  else if (highImpactCount > 0 && !recentlyFetched) fetchDecision.reason = `${highImpactCount} high-impact events detected`;
  else if (matched.length < 3 && !recentlyFetched) fetchDecision.reason = 'thin_news_coverage';
  else if (recentlyFetched) fetchDecision.reason = 'skipped (recently fetched)';

  // Fetch article bodies for important headlines
  if (autoFetch && matched.length > 0) {
    // Priority sort: HIGH IMPACT first, then newest, then by source quality
    const sorted = [...matched].sort((a, b) => {
      if (a.is_high_impact !== b.is_high_impact) return b.is_high_impact ? 1 : -1;
      const aTime = a.published ? new Date(a.published).getTime() : 0;
      const bTime = b.published ? new Date(b.published).getTime() : 0;
      return bTime - aTime;
    });
    const toFetch = sorted.slice(0, Math.min(5, sorted.length));
    for (const h of toFetch) {
      try {
        const resp = await fetchWithRetry(h.link, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)' } }, { label: 'article-body', retries: 0, timeoutMs: 7000, silent: true });
        const html = await resp.text();
        let body = html;
        const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        if (articleMatch) body = articleMatch[1];
        body = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        h.body_excerpt = body.slice(0, 600);
        // Re-match with body — find NEW currency mentions
        const fullText = (h.title + ' ' + body).toLowerCase();
        for (const [ccy, keywords] of Object.entries(CURRENCY_KEYWORDS)) {
          if (!h.currencies.includes(ccy) && keywords.some(kw => fullText.includes(kw))) h.currencies.push(ccy);
        }
        h.sentiment = sentimentFromText(fullText.slice(0, 2000));
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        h.body_fetch_error = e.message.slice(0, 50);
      }
    }
  }

  // Build per-currency sentiment
  const currencySentiment = {};
  for (const h of matched) {
    for (const ccy of h.currencies) {
      if (!currencySentiment[ccy]) currencySentiment[ccy] = { bullish: 0, bearish: 0, neutral: 0, headlines: [] };
      currencySentiment[ccy][h.sentiment]++;
      currencySentiment[ccy].headlines.push({
        title: h.title, sentiment: h.sentiment, impact: h.is_high_impact ? 'HIGH' : 'normal',
        source: h.source, published: h.published,
        excerpt: h.body_excerpt || h.description || null,
      });
    }
  }

  return {
    time: new Date().toISOString(),
    bodies_fetched_at: autoFetch ? new Date().toISOString() : null,
    fetch_decision: fetchDecision,
    total_fetched: headlines.length,
    forex_relevant: matched.length,
    high_impact: matched.filter(h => h.is_high_impact).length,
    bodies_fetched: matched.filter(h => h.body_excerpt).length,
    feeds_queried: feedStats,
    currency_sentiment: currencySentiment,
    top_headlines: matched.slice(0, 20).map(h => ({
      title: h.title, link: h.link, source: h.source, published: h.published,
      currencies: h.currencies, sentiment: h.sentiment,
      impact: h.is_high_impact ? 'HIGH' : 'normal',
      description: h.description || null,
      body_excerpt: h.body_excerpt || null,
    })),
    errors,
  };
}

// Save news to persistent history log
export function persistForexNews(state, newsData) {
  if (!newsData || !newsData.top_headlines) return;
  state.forex_news_history = state.forex_news_history || [];

  // Add high-impact and recent headlines that are NOT already in history
  for (const h of newsData.top_headlines) {
    const key = h.link || h.title;
    if (!key) continue;
    const exists = state.forex_news_history.some(existing => (existing.link || existing.title) === key);
    if (!exists) {
      state.forex_news_history.unshift({
        ...h,
        saved_at: new Date().toISOString(),
      });
    }
  }

  // Keep last 200 unique headlines
  state.forex_news_history = state.forex_news_history.slice(0, 200);
}

// Build news context for a specific pair
export function buildForexNewsContext(newsData, symbol) {
  if (!newsData || !newsData.currency_sentiment) return '';
  const parts = (symbol || '').split('/');
  if (parts.length !== 2) return '';
  const [base, quote] = parts;

  const lines = [`\n═══ NEWS INTELLIGENCE (${newsData.forex_relevant} relevant headlines) ═══`];

  for (const ccy of [base, quote]) {
    const data = newsData.currency_sentiment[ccy];
    if (!data) continue;
    const total = data.bullish + data.bearish + data.neutral;
    const bias = data.bullish > data.bearish ? 'BULLISH' : data.bearish > data.bullish ? 'BEARISH' : 'NEUTRAL';
    lines.push(`\n${ccy}: ${bias} (${data.bullish}↑ ${data.bearish}↓ ${data.neutral}→ from ${total} headlines)`);
    const topHL = (data.headlines || []).filter(h => h.impact === 'HIGH').slice(0, 3);
    if (!topHL.length) {
      const anyHL = (data.headlines || []).slice(0, 2);
      for (const h of anyHL) {
        const excerpt = h.excerpt ? ` [${h.excerpt.slice(0, 150)}...]` : '';
        lines.push(`  ${h.sentiment === 'bullish' ? '↑' : h.sentiment === 'bearish' ? '↓' : '→'} ${h.title.slice(0, 80)}${excerpt}`);
      }
    } else {
      for (const h of topHL) {
        const excerpt = h.excerpt ? `\n     Context: ${h.excerpt.slice(0, 200)}...` : '';
        lines.push(`  ⚡ HIGH IMPACT: ${h.title.slice(0, 80)} [${h.sentiment}]${excerpt}`);
      }
    }
  }

  // Pair implication
  const baseData = newsData.currency_sentiment[base];
  const quoteData = newsData.currency_sentiment[quote];
  if (baseData && quoteData) {
    const baseBias = (baseData.bullish - baseData.bearish);
    const quoteBias = (quoteData.bullish - quoteData.bearish);
    if (baseBias > quoteBias) lines.push(`\n→ NEWS FAVORS: ${symbol} HIGHER (${base} bullish vs ${quote})`);
    else if (quoteBias > baseBias) lines.push(`\n→ NEWS FAVORS: ${symbol} LOWER (${quote} bullish vs ${base})`);
    else lines.push(`\n→ NEWS: No clear direction for ${symbol}`);
  }

  if (newsData.high_impact > 0) lines.push(`\n⚡ ${newsData.high_impact} HIGH IMPACT events detected — expect volatility!`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// MANUAL TRADING MODE — User trades externally, reports result
// ═══════════════════════════════════════════════════════════════

export function createManualTradePlan(state, { symbol, direction, signal_data, current_price_fresh }) {
  const cfg = state.config || {};
  const bankroll = state.forex_bankroll ?? Number(cfg.forex_bankroll || 100);
  const payoutPct = Number(cfg.forex_payout_pct || 85);
  const learning = analyzeForexLearning(state);

  // Use fresh price if provided (from real-time fetch), else fall back to signal price
  const priceUsed = current_price_fresh != null ? current_price_fresh : signal_data?.current_price;
  const priceAgeSec = signal_data?.time ? Math.floor((Date.now() - new Date(signal_data.time).getTime()) / 1000) : null;

  // Calculate recommended amount using Kelly-lite
  const confidence = signal_data?.confidence || 0.55;
  let score = confidence;

  // Adjust by learning
  if (learning.ready) {
    const pairData = learning.by_pair?.find(p => p.pair === symbol);
    if (pairData && pairData.total >= 5) {
      if (pairData.win_rate >= 58) score += 0.1;
      else if (pairData.win_rate < 45) score -= 0.15;
    }
  }
  score = Math.max(0.25, Math.min(0.8, score));

  const winProb = 0.5 + score * 0.25;
  const kellyPct = Math.max(0, (winProb * (payoutPct / 100) - (1 - winProb)) / (payoutPct / 100));
  const quarterKelly = kellyPct * 0.25;
  const coldStartFactor = learning.cold_start ? (learning.cold_start_size_factor || 0.5) : 1.0;
  const recAmount = Math.max(1, Math.min(bankroll * 0.1, Math.round(bankroll * quarterKelly * coldStartFactor)));

  // Recommended duration
  let recDuration = Number(cfg.forex_default_duration || 3);
  if (learning.ready && learning.by_duration?.length) {
    const bestDur = learning.by_duration.find(d => d.win_rate >= 55 && d.total >= 5);
    if (bestDur) recDuration = parseInt(bestDur.duration) || recDuration;
  }

  // Time window — valid from NOW to NOW+2min (markets move fast)
  const validFrom = new Date();
  const validUntil = new Date(Date.now() + 2 * 60 * 1000);

  const plan = {
    id: 'mt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    symbol,
    direction,
    recommended_amount: recAmount,
    recommended_duration_min: recDuration,
    signal_confidence: signal_data?.confidence || null,
    signal_strength: signal_data?.signal_strength || 'NONE',
    current_price: priceUsed || null,
    signal_price: signal_data?.current_price || null,
    price_age_sec: priceAgeSec,
    price_was_refreshed: current_price_fresh != null,
    bankroll_at_plan: bankroll,
    valid_from: validFrom.toISOString(),
    valid_until: validUntil.toISOString(),
    valid_from_time: validFrom.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    valid_until_time: validUntil.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    instructions: `Eröffne auf deiner Broker-Plattform einen ${direction} Trade auf ${symbol} mit $${recAmount} Einsatz und ${recDuration} Min Dauer. Trade möglichst bis ${validUntil.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} eröffnen — danach ist das Signal evtl. nicht mehr gültig.`,
    status: 'PENDING', // PENDING → EXECUTED → RESULT_REPORTED
    created_at: new Date().toISOString(),
    // These fields are filled when user reports back
    actual_entry_time: null,
    actual_entry_price: null,
    actual_exit_price: null,
    actual_amount: null,
    actual_duration_min: null,
    actual_result: null, // WIN / LOSS / DRAW
    actual_pnl: null,
    // Learning data (copy from signal for later analysis)
    indicators: signal_data?.indicators ? Object.fromEntries(Object.entries(signal_data.indicators).map(([k, v]) => [k, { score: v.score }])) : {},
    patterns: (signal_data?.patterns || []).map(p => typeof p === 'string' ? p : p.name),
    hour: new Date().getUTCHours(),
  };

  state.manual_trade_plans = state.manual_trade_plans || [];
  state.manual_trade_plans.unshift(plan);
  state.manual_trade_plans = state.manual_trade_plans.slice(0, 100);
  return plan;
}

export function reportManualTradeResult(state, planId, { amount, duration_min, result, entry_price, exit_price, entry_time, payout_pct }) {
  const plan = (state.manual_trade_plans || []).find(p => p.id === planId);
  if (!plan) return { ok: false, error: 'Plan nicht gefunden' };
  if (plan.status !== 'PENDING') return { ok: false, error: `Plan ist ${plan.status}, kann nicht mehr gemeldet werden` };

  const cfg = state.config || {};
  // Custom payout (0-92% range typical). Falls nicht gesetzt → default from config
  const actualPayout = payout_pct != null && !isNaN(Number(payout_pct))
    ? Math.max(0, Math.min(92, Number(payout_pct)))
    : Number(cfg.forex_payout_pct || 85);

  plan.status = 'RESULT_REPORTED';
  plan.actual_amount = Number(amount || plan.recommended_amount);
  plan.actual_duration_min = Number(duration_min || plan.recommended_duration_min);
  plan.actual_entry_time = entry_time || new Date().toISOString();
  plan.actual_entry_price = entry_price != null ? Number(entry_price) : null;
  plan.actual_exit_price = exit_price != null ? Number(exit_price) : null;
  plan.actual_result = result;
  plan.actual_payout_pct = actualPayout;
  plan.reported_at = new Date().toISOString();

  // Calculate PnL with CUSTOM payout %
  if (result === 'WIN') {
    plan.actual_pnl = Number((plan.actual_amount * (actualPayout / 100)).toFixed(2));
  } else if (result === 'LOSS') {
    plan.actual_pnl = -plan.actual_amount;
  } else {
    plan.actual_pnl = 0;
  }

  // Update bankroll
  state.forex_bankroll = Number(((state.forex_bankroll ?? Number(cfg.forex_bankroll || 100)) + plan.actual_pnl).toFixed(2));

  // Also add to forex_trades so learning picks it up
  state.forex_trades = state.forex_trades || [];
  state.forex_trades.unshift({
    id: plan.id,
    type: 'MANUAL',
    symbol: plan.symbol,
    direction: plan.direction,
    duration_min: plan.actual_duration_min,
    amount: plan.actual_amount,
    entry_price: plan.actual_entry_price,
    exit_price: plan.actual_exit_price,
    opened_at: plan.actual_entry_time,
    expires_at: plan.actual_entry_time,
    status: 'CLOSED',
    result: result,
    payout_pct: actualPayout,
    pnl: plan.actual_pnl,
    confidence: plan.signal_confidence,
    signal_strength: plan.signal_strength,
    indicators: plan.indicators,
    patterns: plan.patterns,
    hour: plan.hour,
    manual: true,
  });

  return { ok: true, plan, new_bankroll: state.forex_bankroll, payout_used: actualPayout };
}

// ═══════════════════════════════════════════════════════════════
// BACKTEST — replay strategy on historical candles
// ═══════════════════════════════════════════════════════════════

export async function runBacktest(state, { symbol, interval = '5min', candles_count = 200, duration_min = 3 }) {
  const cfg = state.config || {};
  const payoutPct = Number(cfg.forex_payout_pct || 85);
  const spreadPips = Number(cfg.forex_spread_pips || 1.5);
  const simulateSpread = cfg.forex_simulate_spread !== false;
  const pipSize = symbol.includes('JPY') ? 0.01 : 0.0001;

  // Fetch historical candles
  const candles = await fetchCandleData(symbol, interval, candles_count);
  if (!candles || candles.length < 60) {
    return { ok: false, error: `Zu wenig Candles verfügbar (${candles?.length || 0}). Mindestens 60 nötig.` };
  }

  // Determine how many candles represent 'duration_min' for this interval
  const intervalMin = { '1min': 1, '5min': 5, '15min': 15, '30min': 30, '1h': 60 }[interval] || 5;
  const candlesAhead = Math.max(1, Math.round(duration_min / intervalMin));

  const trades = [];
  let bankroll = 100;
  let peak = 100;
  let maxDrawdown = 0;
  let wins = 0, losses = 0, draws = 0;

  // Simulate each candle as a potential entry point
  // Skip first 50 (need indicator warmup), leave last candlesAhead for resolution
  const simRange = { start: 50, end: candles.length - candlesAhead };

  for (let i = simRange.start; i < simRange.end; i++) {
    const window = candles.slice(Math.max(0, i - 50), i + 1);
    const closes = window.map(c => c.close);

    // Compute RSI(14)
    const rsi = computeRsi(closes, 14);
    if (rsi == null) continue;

    // Compute trend (SMA 20 vs 50)
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, closes.length);
    const trendUp = sma20 > sma50;

    // Signal logic: CALL if RSI<30 AND trend up; PUT if RSI>70 AND trend down
    let direction = null;
    if (rsi < 30 && trendUp) direction = 'CALL';
    else if (rsi > 70 && !trendUp) direction = 'PUT';
    if (!direction) continue;

    const entryCandle = candles[i];
    const exitCandle = candles[i + candlesAhead];
    if (!entryCandle || !exitCandle) continue;

    let entryPrice = entryCandle.close;
    let exitPrice = exitCandle.close;

    // Apply spread
    if (simulateSpread) {
      const spreadCost = spreadPips * pipSize;
      if (direction === 'CALL') exitPrice -= spreadCost;
      else exitPrice += spreadCost;
    }

    const stake = Math.max(1, Math.round(bankroll * 0.05));
    let result, pnl;
    if (direction === 'CALL') {
      result = exitPrice > entryPrice ? 'WIN' : exitPrice < entryPrice ? 'LOSS' : 'DRAW';
    } else {
      result = exitPrice < entryPrice ? 'WIN' : exitPrice > entryPrice ? 'LOSS' : 'DRAW';
    }
    if (result === 'WIN') { pnl = stake * (payoutPct / 100); wins++; }
    else if (result === 'LOSS') { pnl = -stake; losses++; }
    else { pnl = 0; draws++; }

    bankroll += pnl;
    peak = Math.max(peak, bankroll);
    const dd = (peak - bankroll) / peak;
    maxDrawdown = Math.max(maxDrawdown, dd);

    trades.push({
      time: entryCandle.datetime, direction,
      entry: entryPrice, exit: exitPrice, rsi: rsi.toFixed(1),
      result, pnl: Number(pnl.toFixed(2)), bankroll: Number(bankroll.toFixed(2)),
    });
  }

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
  const totalPnl = bankroll - 100;
  const ci = totalTrades > 0 ? wilsonInterval(wins, totalTrades) : [0, 0];

  return {
    ok: true,
    symbol, interval, duration_min,
    candles_used: candles.length,
    strategy: 'RSI + Trend (CALL: RSI<30 + trend up, PUT: RSI>70 + trend down)',
    total_trades: totalTrades,
    wins, losses, draws,
    win_rate: Number(winRate.toFixed(1)),
    wr_ci_lower: Number(ci[0].toFixed(1)),
    wr_ci_upper: Number(ci[1].toFixed(1)),
    starting_bankroll: 100,
    final_bankroll: Number(bankroll.toFixed(2)),
    total_pnl: Number(totalPnl.toFixed(2)),
    max_drawdown_pct: Number((maxDrawdown * 100).toFixed(1)),
    break_even_wr: Number((100 / (100 + payoutPct) * 100).toFixed(1)),
    profitable: totalPnl > 0,
    trades: trades.slice(-20), // last 20 as sample
  };
}

// Simple RSI helper for backtest
function computeRsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
