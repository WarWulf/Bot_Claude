// platforms.js — Polymarket and Kalshi API clients (robust, with fallbacks + logging)

import crypto from 'node:crypto';
import { loadState } from './appState.js';
import { fetchWithRetry, pushLiveComm } from './utils.js';

function detectCategory(question) {
  const q = (question || '').toLowerCase();
  const cats = {
    finance:['stock','s&p','nasdaq','dow','treasury','fed ','interest rate','gdp','inflation','earnings','ipo','forex','bond','yield','recession','jobs report','cpi','fomc'],
    crypto:['bitcoin','btc','eth','ethereum','crypto','solana','dogecoin','xrp','coinbase','binance'],
    politics:['election','president','congress','senate','governor','vote','trump','biden','democrat','republican','nomination','impeach'],
    sports:['nfl','nba','mlb','nhl','fifa','super bowl','championship','playoff','soccer','football','basketball','baseball','tennis','f1','ufc','olympics'],
    weather:['temperature','rain','snow','hurricane','tornado','weather','storm','flood','wildfire'],
    tech:['ai ','openai','google','apple','microsoft','nvidia','spacex','semiconductor','quantum'],
    entertainment:['oscar','grammy','emmy','movie','film','netflix','disney','streaming','award'],
    economy:['tariff','sanction','trade war','housing','mortgage','unemployment','supply chain'],
    legal:['trial','verdict','guilty','lawsuit','indictment','ruling','court','settlement'],
    geopolitics:['war','conflict','nato','china','russia','ukraine','taiwan','iran','israel','ceasefire'],
  };
  for (const [cat, keywords] of Object.entries(cats)) {
    if (keywords.some(kw => q.includes(kw))) return cat;
  }
  return 'other';
}

export function buildPolymarketAuthHeaders() {
  const state = loadState();
  const provider = state.providers?.polymarket || {};
  return { 'x-pm-address': provider.wallet_address || '', 'x-pm-signature': provider.eip712_signature || '' };
}

export function buildKalshiAuthHeaders(path = '/trade-api/v2/markets') {
  const state = loadState();
  const provider = state.providers?.kalshi || {};
  const keyId = String(provider.key_id || '').trim();
  const keySecret = String(provider.key_secret || '').trim();
  if (!keyId || !keySecret) return {};
  try {
    const ts = Math.floor(Date.now() / 1000).toString();
    const msg = ts + 'GET' + path;
    const sig = crypto.createHmac('sha256', keySecret).update(msg).digest('base64');
    return { 'KALSHI-ACCESS-KEY': keyId, 'KALSHI-ACCESS-SIGNATURE': sig, 'KALSHI-ACCESS-TIMESTAMP': ts };
  } catch { return {}; }
}

// ═══════════════════════════════════════════
// POLYMARKET — fetch active markets
// ═══════════════════════════════════════════
export async function fetchPolymarketMarkets(limit = 200) {
  const cfg = loadState().config || {};
  const timeout = Number(cfg.scanner_http_timeout_ms || 10000);
  const retries = Number(cfg.scanner_http_retries || 2);
  let rawItems = [];

  // Try primary endpoint
  try {
    const resp = await fetchWithRetry(
      'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200',
      { headers: { 'Accept': 'application/json' } },
      { label: 'polymarket', retries, timeoutMs: timeout }
    );
    const data = await resp.json();
    rawItems = Array.isArray(data) ? data : (data?.data || data?.markets || []);
  } catch (e) {
    pushLiveComm('scan_warning', { source: 'polymarket', message: `Primary API failed: ${e.message}` });
    // Fallback: try CLOB events endpoint
    try {
      const resp = await fetchWithRetry(
        'https://clob.polymarket.com/markets',
        { headers: { 'Accept': 'application/json' } },
        { label: 'polymarket-clob', retries: 1, timeoutMs: timeout, silent: true }
      );
      const data = await resp.json();
      rawItems = Array.isArray(data) ? data : (data?.data || data?.markets || data?.next_cursor ? data.data || [] : []);
    } catch { /* both endpoints failed */ }
  }

  pushLiveComm('scan_detail', { source: 'polymarket', raw_items: rawItems.length });

  return rawItems.map((item) => {
    const question = String(item.question || item.title || item.slug || item.description || '').trim();
    let price = Number(item.probability ?? item.lastTradePrice ?? item.price ?? item.outcomePrices?.[0]);
    if (typeof item.outcomePrices === 'string') {
      try { price = Number(JSON.parse(item.outcomePrices)[0]); } catch {}
    }
    if (price > 1 && price <= 100) price /= 100;
    if (!question || question.length < 6 || Number.isNaN(price) || price < 0 || price > 1) return null;
    // Calculate days to expiry
    let daysToExpiry = Number(item.daysToExpiration || 0);
    if (!daysToExpiry) {
      const endStr = item.end_date_iso || item.endDate || item.close_time || item.resolution_date || item.expirationDate || '';
      if (endStr) {
        const endMs = new Date(endStr).getTime();
        if (endMs > Date.now()) daysToExpiry = Math.ceil((endMs - Date.now()) / 86400000);
      }
    }
    if (!daysToExpiry) daysToExpiry = 30;
    const tags = Array.isArray(item.tags) ? item.tags.map(t => String(t).toLowerCase()).join(' ') : '';
    const groupSlug = String(item.groupSlug || item.group_slug || '').toLowerCase();
    return {
      platform: 'polymarket', question,
      market: String(item.conditionId || item.id || question).slice(0, 180),
      outcome: 'YES',
      market_price: Number(price.toFixed(4)),
      prev_market_price: Number(item.bestBid || item.previousPrice || price),
      bid: Number(item.bestBid || item.bid || price),
      ask: Number(item.bestAsk || item.ask || price),
      spread: Number(item.spread || Math.abs(Number(item.bestAsk || price) - Number(item.bestBid || price))),
      status: 'open',
      volume: Number(item.volume || item.volumeNum || 0),
      volume_7d_avg: Number(item.volumeNum || item.volume || 0),
      liquidity: Number(item.liquidity || 0),
      days_to_expiry: daysToExpiry,
      category: detectCategory(question + ' ' + tags + ' ' + groupSlug),
      end_date: item.end_date_iso || item.endDate || item.close_time || '',
    };
  }).filter(Boolean).slice(0, limit);
}

// ═══════════════════════════════════════════
// KALSHI — fetch active markets (cascading endpoints)
// ═══════════════════════════════════════════
export async function fetchKalshiMarkets(limit = 200) {
  const headers = buildKalshiAuthHeaders('/trade-api/v2/markets');
  const cfg = loadState().config || {};
  const timeout = Number(cfg.scanner_http_timeout_ms || 10000);
  const endpoints = [
    { url: 'https://trading-api.kalshi.com/trade-api/v2/markets?limit=200&status=open', label: 'kalshi-main' },
    { url: 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=200&status=open', label: 'kalshi-elections' },
    { url: 'https://demo-api.kalshi.co/trade-api/v2/markets?limit=200&status=open', label: 'kalshi-demo' },
  ];
  let allItems = [];
  let usedEndpoint = '';

  for (const ep of endpoints) {
    try {
      const resp = await fetchWithRetry(ep.url, { headers }, { label: ep.label, retries: 1, timeoutMs: timeout, silent: true });
      const data = await resp.json();
      const items = data?.markets || [];
      if (items.length) {
        allItems = items;
        usedEndpoint = ep.label;
        pushLiveComm('scan_detail', { source: ep.label, raw_items: items.length });
        break;
      }
    } catch { continue; }
  }

  if (!allItems.length) {
    pushLiveComm('scan_warning', { source: 'kalshi', message: `All ${endpoints.length} endpoints failed or returned 0 markets` });
  }

  const seenTickers = new Set();
  return allItems.map((item) => {
    const ticker = String(item.ticker || '');
    if (seenTickers.has(ticker)) return null;
    seenTickers.add(ticker);
    const yesBid = Number(item.yes_bid); const yesAsk = Number(item.yes_ask);
    const lastPrice = Number(item.last_price);
    let price = 0.5;
    if (!Number.isNaN(yesBid) && !Number.isNaN(yesAsk) && yesBid > 0) price = (yesBid + yesAsk) / 200;
    else if (!Number.isNaN(lastPrice) && lastPrice > 0) price = lastPrice / 100;
    let daysToExpiry = 0;
    const closeStr = item.close_time || item.expiration_time || item.expected_expiration_time || '';
    if (closeStr) {
      const closeMs = new Date(closeStr).getTime();
      if (closeMs > Date.now()) daysToExpiry = Math.ceil((closeMs - Date.now()) / 86400000);
    }
    if (!daysToExpiry) daysToExpiry = 30;
    const question = String(item.title || item.subtitle || item.ticker || 'Kalshi Market');
    return {
      platform: 'kalshi', question,
      market: ticker.slice(0, 180), outcome: 'YES',
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
  }).filter(Boolean).slice(0, limit);
}

// ═══════════════════════════════════════════
// CONNECTION TESTS
// ═══════════════════════════════════════════
export async function runPolymarketConnectionTest(cfg = {}) {
  const out = { configured: true, reachable: false, http_ok: false, markets_sampled: 0, error: '' };
  try {
    const resp = await fetchWithRetry('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=3', {}, { label: 'polymarket-connectivity', retries: 1, timeoutMs: Number(cfg.scanner_http_timeout_ms || 10000), silent: true });
    const data = await resp.json();
    const items = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    out.reachable = true; out.http_ok = true; out.markets_sampled = items.length;
  } catch (e) { out.error = String(e?.message || e).slice(0, 100); }
  return out;
}

export async function runKalshiConnectionTest(cfg = {}) {
  const ka = buildKalshiAuthHeaders('/trade-api/v2/markets');
  const out = { configured: Boolean(ka['KALSHI-ACCESS-KEY']), reachable: false, http_ok: false, markets_sampled: 0, error: '' };
  try {
    const resp = await fetchWithRetry('https://api.elections.kalshi.com/trade-api/v2/markets?limit=3', { headers: ka }, { label: 'kalshi-connectivity', retries: 1, timeoutMs: Number(cfg.scanner_http_timeout_ms || 10000), silent: true });
    const data = await resp.json();
    out.reachable = true; out.http_ok = true; out.markets_sampled = (data?.markets || []).length;
  } catch (e) { out.error = String(e?.message || e).slice(0, 100); }
  return out;
}
