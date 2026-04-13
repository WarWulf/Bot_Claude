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
  const cfg = state.config || {};
  const top = (state.scan_results || []).slice(0, Number(cfg.top_n || 10));
  const minOverlap = Math.max(1, Number(cfg.research_min_keyword_overlap || 2));
  const minCredibility = Math.max(0, Math.min(1, Number(cfg.research_min_credibility || 0.4)));

  // Track what we searched and where (transparency)
  const searchLog = {
    time: new Date().toISOString(),
    sources_queried: [],
    total_headlines_fetched: 0,
    markets_analyzed: top.length,
  };

  // Log which sources we're querying
  if (Boolean(cfg.research_source_rss ?? true)) {
    const feeds = String(cfg.research_rss_feeds || '').split(',').map(x => x.trim()).filter(Boolean);
    searchLog.sources_queried.push({ type: 'rss', feeds: feeds.map(f => f.slice(0, 80)), count: feeds.length });
  }
  if (Boolean(cfg.research_source_reddit ?? true)) {
    const subs = String(cfg.research_reddit_subreddits || 'politics,worldnews,PredictionMarkets').split(',').map(x => x.trim()).filter(Boolean);
    const query = String(cfg.research_reddit_query || 'election OR policy OR legal OR odds');
    searchLog.sources_queried.push({ type: 'reddit', subreddits: subs, search_query: query });
  }
  if (Boolean(cfg.research_source_newsapi) && String(cfg.research_newsapi_key || '').trim()) {
    searchLog.sources_queried.push({ type: 'newsapi', query: String(cfg.research_newsapi_query || 'prediction market') });
  }
  if (Boolean(cfg.research_source_gdelt)) {
    searchLog.sources_queried.push({ type: 'gdelt', query: String(cfg.research_gdelt_query || 'prediction market') });
  }
  if (Boolean(cfg.research_source_x)) {
    const feeds = String(cfg.research_x_rss_feeds || '').split(',').map(x => x.trim()).filter(Boolean);
    searchLog.sources_queried.push({ type: 'x_rss', feeds: feeds.map(f => f.slice(0, 80)) });
  }

  const headlines = (await fetchResearchHeadlines(cfg))
    .map((h) => {
      const host = (() => { try { return new URL(h.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      return { ...h, tokens: tokenize(h.title), domain: host, credibility: DOMAIN_CREDIBILITY[host] || 0.5, recency: recencyWeight(h.published_at) };
    });

  searchLog.total_headlines_fetched = headlines.length;
  // Count per source type
  searchLog.headlines_per_source = {};
  headlines.forEach(h => { const t = h.source_type || 'unknown'; searchLog.headlines_per_source[t] = (searchLog.headlines_per_source[t] || 0) + 1; });

  const briefs = top.map((m) => {
    const marketTokens = tokenize(m.question);
    const matched = headlines.filter((h) => {
      const overlap = marketTokens.filter((t) => h.tokens.includes(t)).length;
      return overlap >= minOverlap && h.credibility >= minCredibility;
    }).map((h) => {
      const overlapTokens = marketTokens.filter((t) => h.tokens.includes(t));
      const overlap = overlapTokens.length;
      return { ...h, overlap, matched_keywords: overlapTokens, evidence_score: Number((overlap * 0.3 + h.credibility * 0.4 + h.recency * 0.3).toFixed(3)) };
    }).sort((a, b) => b.evidence_score - a.evidence_score).slice(0, 8);

    const sentimentVotes = { bullish: 0, bearish: 0, neutral: 0 };
    matched.forEach((h) => { sentimentVotes[sentimentFromText(h.title)] += 1; });
    const sentiment = sentimentVotes.bullish > sentimentVotes.bearish ? 'bullish' : sentimentVotes.bearish > sentimentVotes.bullish ? 'bearish' : 'neutral';
    const evidenceMean = matched.length ? matched.reduce((s, x) => s + x.evidence_score, 0) / matched.length : 0;
    const confidence = Number(Math.min(0.95, 0.3 + evidenceMean * 0.25 + Math.min(0.2, matched.length * 0.04)).toFixed(3));
    const narrativeGap = Number(Math.max(0, ((m.opportunity_score || 0) / 100) - Math.min(0.25, evidenceMean * 0.2)).toFixed(3));
    const stance = matched.length >= 3 ? 'supported' : matched.length === 2 ? 'mixed' : 'unclear';
    const narrativeConsensusProb = Number(Math.max(0.01, Math.min(0.99, sentiment === 'bullish' ? 0.62 + Math.min(0.2, matched.length * 0.03) : sentiment === 'bearish' ? 0.38 - Math.min(0.2, matched.length * 0.03) : 0.5)).toFixed(3));
    const marketPrice = Number(m.market_price || 0.5);
    const marketNarrativeGap = Number((narrativeConsensusProb - marketPrice).toFixed(3));
    const thesis = matched.length ? `${matched.length} Headlines gefunden (Keywords: ${[...new Set(matched.flatMap(x => x.matched_keywords || []))].join(', ')}).` : 'Keine passenden Headlines gefunden.';
    const catalysts = matched.slice(0, 2).map((x) => x.title);
    const risks = [matched.length < 2 ? 'Dünne Evidenzlage' : null, Number(m.estimated_slippage || 0) > 0.015 ? 'Erhöhte Slippage' : null, Number(m.spread || 0) > 0.04 ? 'Breiter Spread' : null].filter(Boolean);

    // Collect all unique matched keywords for this market
    const allMatchedKeywords = [...new Set(matched.flatMap(x => x.matched_keywords || []))];

    return {
      time: new Date().toISOString(), market_id: m.id, question: m.question,
      search_keywords: marketTokens, matched_keywords: allMatchedKeywords,
      sentiment, market_price: marketPrice,
      narrative_consensus_prob: narrativeConsensusProb, consensus_vs_market_gap: marketNarrativeGap,
      sentiment_breakdown: sentimentVotes, narrative_gap: narrativeGap,
      confidence, stance, thesis, catalysts, risks,
      sources: matched.length ? matched.map(s => ({
        title: s.title, link: s.link, source_type: s.source_type, domain: s.domain,
        matched_keywords: s.matched_keywords, overlap: s.overlap, evidence_score: s.evidence_score,
        published_at: s.published_at, credibility: s.credibility,
      })) : [{ title: 'Keine Treffer', link: '', source_type: 'none', overlap: 0 }],
    };
  });

  state.research_briefs = briefs;
  state.research_search_log = searchLog; // Store the search transparency log
  const sourceDomains = new Set(briefs.flatMap((b) => (b.sources || []).map((s) => s.domain).filter(Boolean)));
  const avgConfidence = briefs.length ? briefs.reduce((sum, b) => sum + Number(b.confidence || 0), 0) / briefs.length : 0;
  // Coverage: how many briefs have at least one real source (not 'none')
  const briefsWithSources = briefs.filter((b) => (b.sources || []).some(s => s.source_type && s.source_type !== 'none'));
  const coverage = top.length ? briefsWithSources.length / top.length : 0;
  // Source diversity: count unique source TYPES that are active (rss, reddit, newsapi etc.)
  const activeSourceTypes = new Set(searchLog.sources_queried.map(s => s.type));
  const sourceBreakdown = briefs.flatMap((b) => b.sources || []).reduce((acc, s) => { const t = s.source_type || 'unknown'; if (t !== 'none') acc[t] = (acc[t] || 0) + 1; return acc; }, {});
  const paperReadyBriefs = briefs.filter((b) => Number(b.confidence || 0) >= 0.58 && (b.sources || []).some(s => s.source_type !== 'none')).length;

  state.research_summary = { completed_at: new Date().toISOString(), analyzed_markets: briefs.length, avg_confidence: Number(avgConfidence.toFixed(3)), source_diversity: activeSourceTypes.size, matched_domains: sourceDomains.size, coverage_pct: Number((coverage * 100).toFixed(1)), source_breakdown: sourceBreakdown, paper_ready_briefs: paperReadyBriefs, paper_ready_pct: Number((briefs.length ? (paperReadyBriefs / briefs.length) * 100 : 0).toFixed(1)), search_log: searchLog, briefs_with_sources: briefsWithSources.length, briefs_without_sources: briefs.length - briefsWithSources.length };
  state.research_runs = state.research_runs || [];
  state.research_runs.unshift({ time: new Date().toISOString(), analyzed: briefs.length, summary: state.research_summary });
  state.research_runs = state.research_runs.slice(0, 50);
  saveState(state);
  return { briefs, summary: state.research_summary, runs: state.research_runs, search_log: searchLog };
}
