// utils.js — Shared utilities: HTTP retry, JSON parsing, live comm log

export const STOP_WORDS = new Set(['the', 'a', 'an', 'for', 'from', 'with', 'will', 'into', 'onto', 'about', 'this', 'that', 'next', 'above', 'below', 'over', 'under', 'and', 'oder', 'und']);

export const DOMAIN_CREDIBILITY = {
  'reutersagency.com': 0.9,
  'reuters.com': 0.9,
  'apnews.com': 0.85,
  'bloomberg.com': 0.85,
  'wsj.com': 0.8
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
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return safeJsonParse(str.slice(start, end + 1), null);
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((x) => x && x.length > 2 && !STOP_WORDS.has(x));
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
  const bullishWords = ['beat', 'win', 'surge', 'gain', 'support', 'favorable', 'strong', 'recant', 'drop charges', 'approval rises'];
  const bearishWords = ['loss', 'fall', 'drop', 'weak', 'lawsuit', 'indict', 'recession', 'scandal', 'risk', 'denied'];
  const bull = bullishWords.some((w) => t.includes(w));
  const bear = bearishWords.some((w) => t.includes(w));
  if (bull && !bear) return 'bullish';
  if (bear && !bull) return 'bearish';
  return 'neutral';
}

export function computeBrierCalibration(outcomes = []) {
  const ready = outcomes.filter((x) => Number.isFinite(Number(x.predicted_prob)) && (x.outcome === 0 || x.outcome === 1));
  const score = ready.length
    ? ready.reduce((sum, x) => sum + ((Number(x.predicted_prob) - Number(x.outcome)) ** 2), 0) / ready.length
    : null;
  return { samples: ready.length, brier_score: score == null ? null : Number(score.toFixed(5)) };
}
