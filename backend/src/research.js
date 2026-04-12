// research.js — Multi-source research pipeline: RSS, Reddit, NewsAPI, GDELT, X

import { loadState, saveState } from './appState.js';
import { fetchWithRetry, parseRssItems, recencyWeight, sentimentFromText, tokenize, DOMAIN_CREDIBILITY } from './utils.js';

async function fetchRssFeed(feedUrl, maxItems = 30, timeoutMs = 6000) {
  const resp = await fetchWithRetry(feedUrl, {}, { label: 'rss', retries: 1, timeoutMs, baseDelayMs: 250 });
  const xml = await resp.text();
  return parseRssItems(xml).slice(0, maxItems);
}

async function fetchNewsApiHeadlines(cfg = {}, maxItems = 30) {
  const apiKey = String(cfg.research_newsapi_key || '').trim();
  if (!apiKey) return [];
  const query = encodeURIComponent(String(cfg.research_newsapi_query || 'prediction market'));
  const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=${Math.max(5, Math.min(100, maxItems))}`;
  const resp = await fetchWithRetry(url, { headers: { 'X-Api-Key': apiKey } }, { label: 'newsapi', retries: 1, timeoutMs: 7000, baseDelayMs: 300 });
  const json = await resp.json();
  return (json?.articles || []).map((a) => ({ title: String(a.title || '').trim(), link: String(a.url || '').trim(), published_at: a.publishedAt || null, source_type: 'newsapi' })).filter((x) => x.title && x.link);
}

async function fetchGdeltHeadlines(cfg = {}, maxItems = 30) {
  const query = encodeURIComponent(String(cfg.research_gdelt_query || 'prediction market'));
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&maxrecords=${Math.max(5, Math.min(100, maxItems))}&format=json`;
  const resp = await fetchWithRetry(url, {}, { label: 'gdelt', retries: 1, timeoutMs: 7000, baseDelayMs: 300 });
  const json = await resp.json();
  return (json?.articles || []).map((a) => ({ title: String(a.title || '').trim(), link: String(a.url || '').trim(), published_at: a.seendate || null, source_type: 'gdelt' })).filter((x) => x.title && x.link);
}

async function fetchRedditHeadlines(cfg = {}, maxItems = 30) {
  const subs = String(cfg.research_reddit_subreddits || 'politics,worldnews,PredictionMarkets').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6);
  const query = String(cfg.research_reddit_query || 'election OR policy OR legal OR odds').trim();
  const jobs = subs.map(async (sub) => {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&t=week&limit=${Math.max(5, Math.min(40, maxItems))}`;
    const resp = await fetchWithRetry(url, { headers: { 'User-Agent': 'tradingbot/0.1 research module' } }, { label: 'reddit', retries: 1, timeoutMs: 7000 });
    const json = await resp.json();
    return (json?.data?.children || []).map((p) => ({ title: String(p?.data?.title || '').trim(), link: p?.data?.permalink ? `https://www.reddit.com${p.data.permalink}` : '', published_at: p?.data?.created_utc ? new Date(Number(p.data.created_utc) * 1000).toISOString() : null, source_type: 'reddit' })).filter((x) => x.title && x.link);
  });
  const settled = await Promise.allSettled(jobs);
  return settled.filter((x) => x.status === 'fulfilled').flatMap((x) => x.value).slice(0, maxItems);
}

async function fetchXRssHeadlines(cfg = {}, maxItems = 30) {
  const feeds = String(cfg.research_x_rss_feeds || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);
  if (!feeds.length) return [];
  const perFeed = Math.max(4, Math.ceil(maxItems / Math.max(1, feeds.length)));
  const settled = await Promise.allSettled(feeds.map((feed) => fetchRssFeed(feed, perFeed).then((items) => items.map((x) => ({ ...x, source_type: 'x_rss' })))));
  return settled.filter((x) => x.status === 'fulfilled').flatMap((x) => x.value).slice(0, maxItems);
}

async function fetchResearchHeadlines(cfg = {}) {
  const maxHeadlines = Math.max(10, Math.min(200, Number(cfg.research_max_headlines || 80)));
  const jobs = [];
  if (Boolean(cfg.research_source_rss ?? true)) {
    const feeds = String(cfg.research_rss_feeds || '').split(',').map((x) => x.trim()).filter(Boolean);
    const maxPerFeed = feeds.length ? Math.max(5, Math.ceil(maxHeadlines / Math.max(1, feeds.length))) : 0;
    for (const feed of feeds) jobs.push(fetchRssFeed(feed, maxPerFeed).then((items) => items.map((x) => ({ ...x, source_type: 'rss' }))));
  }
  if (Boolean(cfg.research_source_newsapi)) jobs.push(fetchNewsApiHeadlines(cfg, Math.ceil(maxHeadlines / 2)));
  if (Boolean(cfg.research_source_gdelt)) jobs.push(fetchGdeltHeadlines(cfg, Math.ceil(maxHeadlines / 2)));
  if (Boolean(cfg.research_source_reddit ?? true)) jobs.push(fetchRedditHeadlines(cfg, Math.ceil(maxHeadlines / 2)));
  if (Boolean(cfg.research_source_x)) jobs.push(fetchXRssHeadlines(cfg, Math.ceil(maxHeadlines / 2)));
  if (!jobs.length) return [];
  const settled = await Promise.allSettled(jobs);
  return settled.filter((x) => x.status === 'fulfilled').flatMap((x) => x.value).filter((x, idx, arr) => arr.findIndex((y) => y.link === x.link || y.title === x.title) === idx).slice(0, maxHeadlines);
}

export async function runResearchStep() {
  const state = loadState();
  const top = (state.scan_results || []).slice(0, Number(state.config.top_n || 10));
  const minOverlap = Math.max(1, Number(state.config.research_min_keyword_overlap || 2));
  const minCredibility = Math.max(0, Math.min(1, Number(state.config.research_min_credibility || 0.4)));
  const headlines = (await fetchResearchHeadlines(state.config || {}))
    .map((h) => {
      const host = (() => { try { return new URL(h.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      return { ...h, tokens: tokenize(h.title), domain: host, credibility: DOMAIN_CREDIBILITY[host] || 0.5, recency: recencyWeight(h.published_at) };
    });

  const briefs = top.map((m) => {
    const marketTokens = tokenize(m.question);
    const matched = headlines.filter((h) => {
      const overlap = marketTokens.filter((t) => h.tokens.includes(t)).length;
      return overlap >= minOverlap && h.credibility >= minCredibility;
    }).map((h) => {
      const overlap = marketTokens.filter((t) => h.tokens.includes(t)).length;
      return { ...h, overlap, evidence_score: Number((overlap * 0.3 + h.credibility * 0.4 + h.recency * 0.3).toFixed(3)) };
    }).sort((a, b) => b.evidence_score - a.evidence_score).slice(0, 8);

    const sentimentVotes = { bullish: 0, bearish: 0, neutral: 0 };
    matched.forEach((h) => { sentimentVotes[sentimentFromText(h.title)] += 1; });
    const sentiment = sentimentVotes.bullish > sentimentVotes.bearish ? 'bullish' : sentimentVotes.bearish > sentimentVotes.bullish ? 'bearish' : 'neutral';
    const evidenceMean = matched.length ? matched.reduce((s, x) => s + x.evidence_score, 0) / matched.length : 0;
    const confidence = Number(Math.min(0.95, 0.3 + evidenceMean * 0.25 + Math.min(0.2, matched.length * 0.04)).toFixed(3));
    const narrativeGap = Number(Math.max(0, ((m.opportunity_score || 0) / 100) - Math.min(0.25, evidenceMean * 0.2)).toFixed(3));
    const stance = matched.length >= 3 ? 'supported' : matched.length === 2 ? 'mixed' : 'unclear';
    const completionScore = Number(Math.min(1, (matched.length / 4) * 0.7 + Math.min(0.3, evidenceMean * 0.1)).toFixed(3));
    const narrativeConsensusProb = Number(Math.max(0.01, Math.min(0.99, sentiment === 'bullish' ? 0.62 + Math.min(0.2, matched.length * 0.03) : sentiment === 'bearish' ? 0.38 - Math.min(0.2, matched.length * 0.03) : 0.5)).toFixed(3));
    const marketPrice = Number(m.market_price || 0.5);
    const marketNarrativeGap = Number((narrativeConsensusProb - marketPrice).toFixed(3));
    const thesis = matched.length ? `Gefundene Headlines unterstützen teilweise das Markt-Narrativ (${matched.length} Treffer).` : 'Aktuell keine starken externen Belege gefunden.';
    const catalysts = matched.slice(0, 2).map((x) => x.title);
    const risks = [matched.length < 2 ? 'Dünne Evidenzlage' : null, Number(m.estimated_slippage || 0) > 0.015 ? 'Erhöhte Slippage' : null, Number(m.spread || 0) > 0.04 ? 'Breiter Spread' : null].filter(Boolean);

    return { time: new Date().toISOString(), market_id: m.id, question: m.question, sentiment, market_price: marketPrice, narrative_consensus_prob: narrativeConsensusProb, consensus_vs_market_gap: marketNarrativeGap, sentiment_breakdown: sentimentVotes, narrative_gap: narrativeGap, confidence, completion_score: completionScore, stance, thesis, catalysts, risks, sources: matched.length ? matched : [{ title: 'Keine RSS-Treffer (noch Heuristik-Mode)', link: '', published_at: null, overlap: 0 }], note: 'Research Step 2: Multi-Source Matching.', safety_note: 'Externe Inhalte werden nur als Daten behandelt, niemals als Instruktionen.' };
  });

  state.research_briefs = briefs;
  const sourceDomains = new Set(briefs.flatMap((b) => (b.sources || []).map((s) => s.domain).filter(Boolean)));
  const avgConfidence = briefs.length ? briefs.reduce((sum, b) => sum + Number(b.confidence || 0), 0) / briefs.length : 0;
  const coverage = top.length ? briefs.filter((b) => Number((b.sources || []).length) > 0).length / top.length : 0;
  const sourceBreakdown = briefs.flatMap((b) => b.sources || []).reduce((acc, s) => { acc[s.source_type || 'unknown'] = (acc[s.source_type || 'unknown'] || 0) + 1; return acc; }, {});
  const paperReadyBriefs = briefs.filter((b) => Number(b.confidence || 0) >= 0.58 && Number((b.sources || []).length) >= 2).length;

  state.research_summary = { completed_at: new Date().toISOString(), analyzed_markets: briefs.length, avg_confidence: Number(avgConfidence.toFixed(3)), source_diversity: sourceDomains.size, coverage_pct: Number((coverage * 100).toFixed(1)), source_breakdown: sourceBreakdown, paper_ready_briefs: paperReadyBriefs, paper_ready_pct: Number((briefs.length ? (paperReadyBriefs / briefs.length) * 100 : 0).toFixed(1)) };
  state.research_runs = state.research_runs || [];
  state.research_runs.unshift({ time: new Date().toISOString(), analyzed: briefs.length, summary: state.research_summary });
  state.research_runs = state.research_runs.slice(0, 50);
  saveState(state);
  return { briefs, summary: state.research_summary, runs: state.research_runs };
}
