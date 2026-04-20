// utils.js — Shared utilities: HTTP retry, JSON parsing, live comm log

export const STOP_WORDS = new Set(['the', 'a', 'an', 'for', 'from', 'with', 'will', 'into', 'onto', 'about', 'this', 'that', 'next', 'above', 'below', 'over', 'under', 'and', 'oder', 'und']);

export const DOMAIN_CREDIBILITY = {
  'reuters.com': 0.92, 'apnews.com': 0.9, 'bloomberg.com': 0.88,
  'wsj.com': 0.85, 'ft.com': 0.85, 'nytimes.com': 0.82,
  'bbc.co.uk': 0.82, 'bbc.com': 0.82, 'economist.com': 0.8,
  'cnbc.com': 0.78, 'marketwatch.com': 0.75, 'cnn.com': 0.72,
  'theguardian.com': 0.72, 'washingtonpost.com': 0.75,
  'politico.com': 0.78, 'axios.com': 0.74,
  'coindesk.com': 0.7, 'theblock.co': 0.68,
  'reddit.com': 0.45, 'twitter.com': 0.4, 'x.com': 0.4,
};

export const liveCommLog = [];

export function pushLiveComm(event, details = {}) {
  liveCommLog.unshift({ t: new Date().toISOString(), event, ...details });
  if (liveCommLog.length > 400) liveCommLog.length = 400;
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeJsonParse(input, fallback = {}) {
  try { return JSON.parse(String(input || '')); } catch { return fallback; }
}

export function clamp01(value, fallback = 0.5) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0.01, Math.min(0.99, n));
}

export function extractFirstJsonObject(text = '') {
  const str = String(text || '').trim();
  if (!str) return null;

  // Strip common wrappers: markdown code fences, explanatory prefixes
  let cleaned = str
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .replace(/^[^{[]*?(?=[{[])/, '') // drop everything before first { or [
    .trim();

  // Try direct parse
  const direct = safeJsonParse(cleaned, null);
  if (direct && typeof direct === 'object') return direct;

  // Find balanced JSON object
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const parsed = safeJsonParse(cleaned.slice(start, i + 1), null);
        if (parsed) return parsed;
      }
    }
  }

  // Last resort: extract key-value pairs manually with regex
  const fallback = {};
  const probMatch = cleaned.match(/probability[_\s]*yes[\s":]+([0-9.]+)/i);
  if (probMatch) fallback.probability_yes = parseFloat(probMatch[1]);
  const confMatch = cleaned.match(/confidence[\s":]+([0-9.]+)/i);
  if (confMatch) fallback.confidence = parseFloat(confMatch[1]);
  const takeMatch = cleaned.match(/take[_\s]*trade[\s":]+(true|false)/i);
  if (takeMatch) fallback.take_trade = takeMatch[1].toLowerCase() === 'true';
  const adjMatch = cleaned.match(/adjusted[_\s]*confidence[\s":]+([0-9.]+)/i);
  if (adjMatch) fallback.adjusted_confidence = parseFloat(adjMatch[1]);
  return Object.keys(fallback).length ? fallback : null;
}

// Simple stemmer for English — reduces words to common root
// "elections", "elected", "electing" → "elect"
function stem(word) {
  if (word.length < 5) return word;
  // Remove common suffixes
  if (word.endsWith('ings')) return word.slice(0, -4);
  if (word.endsWith('ings')) return word.slice(0, -4);
  if (word.endsWith('ions')) return word.slice(0, -4);
  if (word.endsWith('edly')) return word.slice(0, -4);
  if (word.endsWith('ness')) return word.slice(0, -4);
  if (word.endsWith('ment')) return word.slice(0, -4);
  if (word.endsWith('tion')) return word.slice(0, -3);
  if (word.endsWith('sion')) return word.slice(0, -3);
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ied')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('ly') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((x) => x && x.length > 2 && !STOP_WORDS.has(x))
    .map(stem);
}

export async function fetchWithRetry(url, options = {}, cfg = {}) {
  const retries = Math.max(0, Number(cfg.retries ?? 2));
  const timeoutMs = Math.max(1000, Number(cfg.timeoutMs ?? 8000));
  const baseDelayMs = Math.max(100, Number(cfg.baseDelayMs ?? 400));
  const silent = Boolean(cfg.silent); // Don't log errors
  const acceptStatuses = cfg.acceptStatuses || []; // e.g. [401,403] = don't throw on these
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      if (!resp.ok && !acceptStatuses.includes(resp.status)) throw new Error(`${cfg.label || 'http'} http ${resp.status}`);
      if (!silent) pushLiveComm('http_ok', { label: cfg.label || 'http', url: String(url).slice(0, 120), status: resp.status });
      return resp;
    } catch (error) {
      lastError = error;
      if (!silent) pushLiveComm('http_error', { label: cfg.label || 'http', url: String(url).slice(0, 120), message: String(error?.message || error || 'unknown') });
      if (attempt < retries) await wait(baseDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`${cfg.label || 'http'} failed`);
}

export function parseRssItems(xml) {
  const entries = [];
  const blocks = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = (block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').trim();
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '').trim();
    if (!title || !link) continue;
    entries.push({ title, link, published_at: pubDate ? new Date(pubDate).toISOString() : null });
  }
  return entries;
}

export function recencyWeight(publishedAt) {
  if (!publishedAt) return 0.5;
  const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60));
  if (ageHours <= 12) return 1;
  if (ageHours <= 48) return 0.8;
  if (ageHours <= 7 * 24) return 0.6;
  return 0.4;
}

export function sentimentFromText(text = '') {
  const t = String(text || '').toLowerCase();
  const bullishWords = [
    'beat','win','surge','gain','support','favorable','strong','recant','approval rises',
    'rally','soar','jump','boost','upgrade','outperform','bullish','optimistic','growth',
    'exceed','surprise','recover','rebound','break through','milestone','record high',
    'positive','confident','accelerate','expand','improve','profit','succeed','victory',
    'pass','approve','advance','breakthrough','deal','agree','peace','resolve',
    'hire','create jobs','cut rates','stimulus','ease','lower inflation',
  ];
  const bearishWords = [
    'loss','fall','drop','weak','lawsuit','indict','recession','scandal','risk','denied',
    'crash','plunge','decline','downgrade','underperform','bearish','pessimistic','contraction',
    'miss','disappoint','collapse','breakdown','crisis','default','bankruptcy','warning',
    'negative','concern','slowdown','shrink','worsen','deficit','fail','defeat',
    'reject','veto','block','conflict','escalate','sanction','tariff','threat',
    'layoff','cut jobs','raise rates','tighten','higher inflation','overvalued',
  ];
  const bull = bullishWords.filter(w => t.includes(w)).length;
  const bear = bearishWords.filter(w => t.includes(w)).length;
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'neutral';
}

export function computeBrierCalibration(outcomes = []) {
  const ready = outcomes.filter((x) => Number.isFinite(Number(x.predicted_prob)) && (x.outcome === 0 || x.outcome === 1));
  const score = ready.length
    ? ready.reduce((sum, x) => sum + ((Number(x.predicted_prob) - Number(x.outcome)) ** 2), 0) / ready.length
    : null;
  return { samples: ready.length, brier_score: score == null ? null : Number(score.toFixed(5)) };
}
