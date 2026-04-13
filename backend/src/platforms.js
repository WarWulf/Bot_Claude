// platforms.js — Polymarket and Kalshi API clients

import crypto from 'node:crypto';
import { loadState } from './appState.js';
import { fetchWithRetry, pushLiveComm } from './utils.js';

// Auto-detect market category from question text
function detectCategory(question) {
  const q = (question || '').toLowerCase();
  const cats = {
    finance: ['stock','s&p','nasdaq','dow','treasury','fed ','interest rate','gdp','inflation','earnings','ipo','forex','bond','yield','recession','jobs report','cpi','fomc'],
    crypto: ['bitcoin','btc','eth','ethereum','crypto','solana','dogecoin','xrp','coinbase','binance'],
    politics: ['election','president','congress','senate','governor','vote','trump','biden','democrat','republican','nomination','impeach'],
    sports: ['nfl','nba','mlb','nhl','fifa','super bowl','championship','playoff','soccer','football','basketball','baseball','tennis','f1','ufc','olympics'],
    weather: ['temperature','rain','snow','hurricane','tornado','weather','storm','flood','wildfire'],
    tech: ['ai ','openai','google','apple','microsoft','nvidia','spacex','launch','semiconductor','quantum'],
    entertainment: ['oscar','grammy','emmy','movie','film','netflix','disney','streaming','award'],
    economy: ['tariff','sanction','trade war','housing','mortgage','unemployment','gdp','supply chain'],
    legal: ['trial','verdict','guilty','lawsuit','indictment','ruling','court','settlement'],
    geopolitics: ['war','conflict','nato','china','russia','ukraine','taiwan','iran','israel','ceasefire'],
  };
  for (const [cat, keywords] of Object.entries(cats)) {
    if (keywords.some(kw => q.includes(kw))) return cat;
  }
  return 'other';
}

export function buildPolymarketAuthHeaders() {
  const state = loadState();
  const provider = state.providers?.polymarket || {};
  return {
    'x-pm-address': provider.wallet_address || process.env.POLYMARKET_WALLET_ADDRESS || '',
    'x-pm-signature': provider.eip712_signature || process.env.POLYMARKET_EIP712_SIGNATURE || ''
  };
}

export function buildKalshiAuthHeaders(path = '/trade-api/v2/markets') {
  const state = loadState();
  const provider = state.providers?.kalshi || {};
  const keyId = provider.key_id || process.env.KALSHI_KEY_ID || '';
  const secret = provider.key_secret || process.env.KALSHI_KEY_SECRET || '';
  const ts = Date.now().toString();
  const signature = secret
    ? crypto.createHmac('sha256', secret).update(`${ts}GET${path}`).digest('base64')
    : '';
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': signature
  };
}

export async function fetchPolymarketMarkets(limit = 100) {
  const cfg = loadState().config || {};
  // Fetch more markets with pagination for better category diversity
  const allMarkets = [];
  for (let offset = 0; offset < 400; offset += 200) {
    try {
      const resp = await fetchWithRetry(
        `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&offset=${offset}`,
        {},
        { label: 'polymarket', retries: cfg.scanner_http_retries, timeoutMs: cfg.scanner_http_timeout_ms }
      );
      const data = await resp.json();
      const rawItems = Array.isArray(data) ? data : (data?.data || []);
      if (!rawItems.length) break;
      allMarkets.push(...rawItems);
    } catch { break; }
  }

  return allMarkets
    .map((item) => {
      const question = String(item.question || item.title || item.slug || '').trim();
      let price = Number(item.probability ?? item.lastTradePrice ?? item.price);
      if (price > 1 && price <= 100) price /= 100;
      if (!question || question.length < 6 || Number.isNaN(price) || price < 0 || price > 1) return null;
      // Calculate days to expiry from end date
      let daysToExpiry = Number(item.daysToExpiration || 0);
      if (!daysToExpiry) {
        const endStr = item.end_date_iso || item.endDate || item.close_time || item.resolution_date || '';
        if (endStr) {
          const endMs = new Date(endStr).getTime();
          if (endMs > Date.now()) daysToExpiry = Math.ceil((endMs - Date.now()) / 86400000);
        }
      }
      if (!daysToExpiry) daysToExpiry = 30; // fallback
      // Get tags/category from API if available
      const tags = Array.isArray(item.tags) ? item.tags.map(t => String(t).toLowerCase()).join(' ') : '';
      const groupSlug = String(item.groupSlug || item.group_slug || '').toLowerCase();
      return {
        platform: 'polymarket',
        question,
        market: String(item.conditionId || item.id || question).slice(0, 180),
        outcome: 'YES',
        market_price: Number(price.toFixed(4)),
        prev_market_price: Number(item.bestBid || item.previousPrice || price),
        bid: Number(item.bestBid || item.bid || price),
        ask: Number(item.bestAsk || item.ask || price),
        spread: Number(item.spread || Math.abs(Number(item.bestAsk || price) - Number(item.bestBid || price))),
        status: 'open',
        volume: Number(item.volume || 0),
        volume_7d_avg: Number(item.volumeNum || item.volume || 0),
        liquidity: Number(item.liquidity || 0),
        days_to_expiry: daysToExpiry,
        category: detectCategory(question + ' ' + tags + ' ' + groupSlug),
        end_date: item.end_date_iso || item.endDate || item.close_time || '',
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

export async function fetchKalshiMarkets(limit = 100) {
  const headers = buildKalshiAuthHeaders('/trade-api/v2/markets');
  const cfg = loadState().config || {};
  // Try multiple Kalshi endpoints for maximum market coverage
  const endpoints = [
    'https://trading-api.kalshi.com/trade-api/v2/markets?limit=200&status=open',
    'https://api.elections.kalshi.com/trade-api/v2/markets?limit=200&status=open',
    'https://demo-api.kalshi.co/trade-api/v2/markets?limit=200&status=open',
  ];
  let allItems = [];
  for (const url of endpoints) {
    try {
      const resp = await fetchWithRetry(url, { headers }, { label: 'kalshi', retries: 1, timeoutMs: Number(cfg.scanner_http_timeout_ms || 8000) });
      const data = await resp.json();
      const items = data?.markets || [];
      if (items.length) { allItems = items; break; } // Use first endpoint that works
    } catch { continue; }
  }

  const seenTickers = new Set();
  return allItems.slice(0, limit).map((item) => {
    const ticker = String(item.ticker || '');
    if (seenTickers.has(ticker)) return null;
    seenTickers.add(ticker);
    const yesBid = Number(item.yes_bid);
    const yesAsk = Number(item.yes_ask);
    const lastPrice = Number(item.last_price);
    let price = 0.5;
    if (!Number.isNaN(yesBid) && !Number.isNaN(yesAsk)) price = (yesBid + yesAsk) / 200;
    else if (!Number.isNaN(lastPrice)) price = lastPrice / 100;
    // Calculate days to expiry from close_time or expiration_time
    let daysToExpiry = 0;
    const closeStr = item.close_time || item.expiration_time || item.expected_expiration_time || '';
    if (closeStr) {
      const closeMs = new Date(closeStr).getTime();
      if (closeMs > Date.now()) daysToExpiry = Math.ceil((closeMs - Date.now()) / 86400000);
    }
    if (!daysToExpiry) daysToExpiry = 30;
    const question = String(item.title || item.subtitle || item.ticker || 'Kalshi Market');
    return {
      platform: 'kalshi',
      question,
      market: String(item.ticker || item.title || 'kalshi').slice(0, 180),
      outcome: 'YES',
      market_price: Number(price.toFixed(4)),
      prev_market_price: Number(item.previous_yes_price || price),
      bid: !Number.isNaN(yesBid) ? yesBid / 100 : price,
      ask: !Number.isNaN(yesAsk) ? yesAsk / 100 : price,
      spread: (!Number.isNaN(yesBid) && !Number.isNaN(yesAsk)) ? Math.abs(yesAsk - yesBid) / 100 : 0,
      status: String(item.status || 'open').toLowerCase(),
      volume: Number(item.volume || 0),
      volume_7d_avg: Number(item.volume_7d || item.volume || 0),
      liquidity: Number(item.open_interest || 0),
      days_to_expiry: daysToExpiry,
      category: detectCategory(question + ' ' + String(item.category || '')),
      end_date: closeStr,
    };
  }).filter(Boolean);
}

export async function runPolymarketConnectionTest(cfg = {}) {
  const pm = buildPolymarketAuthHeaders();
  const out = { configured: Boolean(pm['x-pm-address'] && pm['x-pm-signature']), reachable: false, http_ok: false, markets_sampled: 0, error: '' };
  try {
    const resp = await fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1', {}, { label: 'polymarket-connectivity', retries: 1, timeoutMs: Number(cfg.scanner_http_timeout_ms || 8000) });
    const data = await resp.json();
    const items = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    out.reachable = true;
    out.http_ok = resp.ok;
    out.markets_sampled = items.length;
  } catch (error) { out.error = String(error?.message || error || 'connectivity test failed'); }
  pushLiveComm('connection_test', { source: 'polymarket', reachable: out.reachable, configured: out.configured, error: out.error || '' });
  return out;
}

export async function runKalshiConnectionTest(cfg = {}) {
  const ka = buildKalshiAuthHeaders('/trade-api/v2/markets?limit=1');
  const out = { configured: Boolean(ka['KALSHI-ACCESS-KEY'] && ka['KALSHI-ACCESS-SIGNATURE']), reachable: false, http_ok: false, markets_sampled: 0, error: '' };
  try {
    const resp = await fetchWithRetry('https://api.elections.kalshi.com/trade-api/v2/markets?limit=1', { headers: ka }, { label: 'kalshi-connectivity', retries: 1, timeoutMs: Number(cfg.scanner_http_timeout_ms || 8000) });
    const data = await resp.json();
    out.reachable = true;
    out.http_ok = resp.ok;
    out.markets_sampled = (data?.markets || []).length;
  } catch (error) { out.error = String(error?.message || error || 'connectivity test failed'); }
  pushLiveComm('connection_test', { source: 'kalshi', reachable: out.reachable, configured: out.configured, error: out.error || '' });
  return out;
}
