// predict.js — LLM provider queries, ensemble estimates, prediction step

import { loadState, saveState } from './appState.js';
import { fetchWithRetry, clamp01, extractFirstJsonObject, computeBrierCalibration, pushLiveComm } from './utils.js';

// Track provider health
const providerHealth = {};
function markProviderResult(name, ok, ms = 0) {
  if (!providerHealth[name]) providerHealth[name] = { ok: 0, fail: 0, totalMs: 0, lastError: null, lastOk: null };
  if (ok) { providerHealth[name].ok += 1; providerHealth[name].totalMs += ms; providerHealth[name].lastOk = Date.now(); }
  else { providerHealth[name].fail += 1; providerHealth[name].lastError = Date.now(); }
}
export function getProviderHealth() { return providerHealth; }

// Quick connectivity test — sends a tiny prompt, expects any response
export async function testLlmProvider(providerName, providerCfg, globalCfg) {
  const testPrompt = 'Return JSON: {"status":"ok"}';
  const start = Date.now();
  try {
    const result = await queryLlmProvider(providerName, providerCfg, globalCfg, testPrompt);
    const ms = Date.now() - start;
    markProviderResult(providerName, true, ms);
    return { ok: true, provider: providerName, ms, response: result ? 'valid' : 'empty' };
  } catch (e) {
    const ms = Date.now() - start;
    markProviderResult(providerName, false, ms);
    return { ok: false, provider: providerName, ms, error: String(e.message || e).slice(0, 100) };
  }
}

export async function queryLlmProvider(providerName, providerCfg, globalCfg, prompt) {
  if (!providerCfg?.enabled) return null;
  const apiKey = String(providerCfg.api_key || '').trim();
  const baseUrl = String(providerCfg.base_url || '').trim();
  const model = String(providerCfg.model || '').trim();
  const isLocalOllama = providerName === 'local_ollama';
  if ((!apiKey && !isLocalOllama) || !baseUrl || !model) return null;
  const timeoutMs = Number(globalCfg.llm_timeout_ms || 25000); // Default 25s statt 12s
  const maxTokens = Number(globalCfg.llm_max_tokens || 220);
  const temperature = Number(globalCfg.llm_temperature ?? 0.1);
  const maxRetries = Number(globalCfg.llm_retries || 2); // Retry on timeout

  // Retry wrapper for timeout errors
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptTimeout = timeoutMs * attempt; // 25s, then 50s
    try {
      const start = Date.now();
      const result = await _queryLlmOnce(providerName, providerCfg, globalCfg, prompt, attemptTimeout, maxTokens, temperature, apiKey, baseUrl, model);
      markProviderResult(providerName, true, Date.now() - start);
      return result;
    } catch (e) {
      lastError = e;
      const isTimeout = String(e.message || '').includes('abort');
      if (!isTimeout || attempt >= maxRetries) {
        markProviderResult(providerName, false);
        throw e;
      }
      pushLiveComm('llm_retry', { provider: providerName, attempt, maxRetries, reason: 'timeout' });
    }
  }
  throw lastError;
}

async function _queryLlmOnce(providerName, providerCfg, globalCfg, prompt, timeoutMs, maxTokens, temperature, apiKey, baseUrl, model) {

  if (providerName === 'gemini') {
    const resp = await fetchWithRetry(`${baseUrl}/models/${model}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature } }) }, { label: 'llm_gemini', retries: 1, timeoutMs });
    const payload = await resp.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('\n') || '';
    const parsed = extractFirstJsonObject(text) || {};
    pushLiveComm('llm_request_ok', { provider: providerName, has_probability: Number.isFinite(Number(parsed?.probability_yes)) });
    return parsed;
  }

  // OpenAI-compatible (openai, claude, ollama_cloud, kimi_direct, local_ollama)
  const headers = { 'Content-Type': 'application/json' };
  if (providerName === 'claude') { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; }
  else if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body = providerName === 'claude'
    ? { model, max_tokens: maxTokens, temperature, messages: [{ role: 'user', content: prompt }] }
    : { model, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: 'You are a professional superforecaster. You estimate probabilities using base rates, evidence updates, and structured reasoning. Return ONLY valid JSON with keys: probability_yes (float 0-1), confidence (float 0-1), rationale (string with your step-by-step reasoning). No markdown, no backticks.' }, { role: 'user', content: prompt }] };

  const endpoint = providerName === 'claude' ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
  const resp = await fetchWithRetry(endpoint, { method: 'POST', headers, body: JSON.stringify(body) }, { label: `llm_${providerName}`, retries: 1, timeoutMs });
  const payload = await resp.json();
  const text = providerName === 'claude'
    ? (payload?.content || []).map((c) => c?.text || '').join('\n')
    : (payload?.choices?.[0]?.message?.content || '');
  const parsed = extractFirstJsonObject(text) || {};
  pushLiveComm('llm_request_ok', { provider: providerName, has_probability: Number.isFinite(Number(parsed?.probability_yes)), rationale: String(parsed?.rationale || '').slice(0, 100) });
  return parsed;
}

export async function buildLlmEnsembleEstimate(market, brief = {}, cfg = {}, providers = {}) {
  if (cfg.llm_enabled === false) return { estimates: {}, notes: ['llm_disabled'] };

  // Collect evidence for the prompt
  const headlines = (brief.sources || []).filter(s => s.title && s.source_type !== 'none').slice(0, 6).map(s => `  • ${s.title} [${s.source_type}${s.domain ? ', '+s.domain : ''}]`).join('\n');
  const daysLeft = Number(market.days_to_expiry || 30);
  const endDate = market.end_date ? new Date(market.end_date).toISOString().slice(0, 10) : '';
  const volume = Number(market.volume || 0);
  const spread = Number(market.spread || 0);
  const category = market.category || 'other';
  const marketPricePct = (Number(market.market_price || 0.5) * 100).toFixed(1);
  const catalysts = (brief.catalysts || []).slice(0, 2).map(c => `  • ${c}`).join('\n');

  const prompt = `You are a professional superforecaster working at a prediction market fund. You use a rigorous, evidence-based methodology to estimate probabilities. You are known for being well-calibrated: when you say 70%, it happens 70% of the time.

═══ MARKET ═══
Question: ${market.question}
Category: ${category}
Current YES price: ${marketPricePct}% (this is what the market thinks — you may disagree)
Expires: ${daysLeft} days remaining${endDate ? ` (${endDate})` : ''}
Volume: ${volume.toLocaleString()} contracts traded
Spread: ${(spread * 100).toFixed(1)} cents

═══ EVIDENCE ═══
${headlines ? `Recent headlines:\n${headlines}` : 'No specific headlines found for this market.'}
${catalysts ? `\nKey catalysts:\n${catalysts}` : ''}

Sentiment analysis: ${brief.sentiment || 'neutral'}${brief.sentiment_breakdown ? ` (${brief.sentiment_breakdown.bullish} bullish / ${brief.sentiment_breakdown.bearish} bearish / ${brief.sentiment_breakdown.neutral} neutral sources)` : ''}
Evidence quality: ${brief.stance === 'supported' ? 'Strong — multiple credible sources agree' : brief.stance === 'mixed' ? 'Mixed — sources disagree' : 'Weak — limited or no credible sources'}
${brief.thesis ? `Research thesis: ${brief.thesis}` : ''}
${(brief.risks || []).length ? `Known risks: ${brief.risks.join('; ')}` : ''}

═══ YOUR ANALYSIS FRAMEWORK ═══
Think through these steps before giving your estimate:

1. DECOMPOSE: What specific conditions must be true for YES to win?
2. BASE RATE: For this type of event (${category}), how often does something like this happen? Start with that as your anchor, not the market price.
3. EVIDENCE UPDATE: Does the news/evidence push the probability UP or DOWN from the base rate? By how much?
4. STRONGEST CASE FOR YES: What is the single strongest argument that this will happen?
5. STRONGEST CASE FOR NO: What is the single strongest argument that this won't happen?
6. MARKET INTELLIGENCE: The market is at ${marketPricePct}%. Why might the market be WRONG? Consider: thin volume means less informed pricing. High volume means smart money has already priced it.
7. TIME FACTOR: With ${daysLeft} days left, how certain can we be? More time = more uncertainty.

═══ CALIBRATION GUIDE ═══
• 90-95%: Almost certain. Only a major surprise prevents this.
• 70-85%: Likely. The evidence clearly favors this outcome.
• 55-65%: Lean towards yes, but significant uncertainty remains.
• 45-55%: True toss-up. Don't pretend you know.
• Below 40%: Evidence suggests this probably won't happen.

═══ OUTPUT ═══
Return ONLY valid JSON. No markdown, no backticks, no text outside the JSON:
{
  "probability_yes": 0.XX,
  "confidence": 0.XX,
  "rationale": "Your step-by-step reasoning in 2-4 sentences. Include: your base rate estimate, how evidence shifted it, and the key factor that determined your final number."
}`;

  const providerOrder = ['openai', 'claude', 'gemini', 'ollama_cloud', 'local_ollama', 'kimi_direct'];
  const rawWeights = { openai: Number(cfg.llm_weight_openai ?? 0.35), claude: Number(cfg.llm_weight_claude ?? 0.25), gemini: Number(cfg.llm_weight_gemini ?? 0.2), ollama_cloud: Number(cfg.llm_weight_ollama_cloud ?? 0.2), local_ollama: Number(cfg.llm_weight_local_ollama ?? 0.15), kimi_direct: Number(cfg.llm_weight_kimi ?? 0.15) };
  const estimates = {};
  const confidences = {};
  const notes = [];
  const rationales = {};

  for (const name of providerOrder) {
    try {
      const out = await queryLlmProvider(name, providers[name] || {}, cfg, prompt);
      if (!out) continue;
      estimates[name] = clamp01(out.probability_yes, Number(market.market_price || 0.5));
      confidences[name] = clamp01(out.confidence, 0.55);
      if (out.rationale) rationales[name] = String(out.rationale).slice(0, 200);
      // Small delay between providers to avoid rate limits
      if (providerOrder.indexOf(name) < providerOrder.length - 1) await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      notes.push(`${name}:${String(error?.message || 'failed').slice(0, 80)}`);
      pushLiveComm('llm_request_error', { provider: name, message: String(error?.message || 'failed').slice(0, 160) });
    }
  }

  const active = Object.keys(estimates);
  if (!active.length) {
    pushLiveComm('llm_ensemble_empty', { market_id: market.id, market: String(market.question || '').slice(0, 120) });
    return { estimates: {}, notes: notes.length ? notes : ['no_llm_provider_available'], rationales: {} };
  }
  const weightSum = active.reduce((sum, name) => sum + Math.max(0, rawWeights[name] || 0), 0) || 1;
  const weighted = active.reduce((sum, name) => { const w = Math.max(0, rawWeights[name] || 0) / weightSum; const c = confidences[name] || 0.55; return sum + (estimates[name] * w * (0.6 + c * 0.4)); }, 0);
  return { estimates, notes, rationales, model_prob: clamp01(weighted, Number(market.market_price || 0.5)) };
}

export async function runPredictStep(state = loadState()) {
  const cfg = state.config || {};
  const minEdge = Number(cfg.step3_min_edge || 0.04);
  const minConfidence = Number(cfg.step3_min_confidence || 0.6);
  const briefsByMarket = new Map((state.research_briefs || []).map((b) => [String(b.market_id), b]));
  const top = (state.scan_results || []).slice(0, Number(cfg.top_n || 10));

  // Process markets SEQUENTIALLY with delay to avoid rate limits (Gemini free: 15/min)
  const llmDelayMs = Number(cfg.llm_delay_between_markets_ms || 4000); // 4s default = max 15 markets/min
  const predictions = [];
  for (let idx = 0; idx < top.length; idx++) {
    const m = top[idx];
    if (idx > 0) await new Promise(r => setTimeout(r, llmDelayMs)); // Rate limit delay
    const brief = briefsByMarket.get(String(m.id)) || {};
    const marketProb = Number(m.market_price || 0.5);
    const briefConfidence = Number(brief.confidence || 0.4);
    const sentiment = String(brief.sentiment || 'neutral');
    const stanceBoost = brief.stance === 'supported' ? 0.04 : brief.stance === 'mixed' ? 0.015 : -0.005;
    const sentimentBias = sentiment === 'bullish' ? 0.035 : sentiment === 'bearish' ? -0.035 : 0;
    const narrativeGap = Number(brief.consensus_vs_market_gap || 0);

    const heuristicEstimates = {
      grok_primary: Math.max(0.01, Math.min(0.99, marketProb + stanceBoost + sentimentBias * 0.7 + narrativeGap * 0.8)),
      claude_news: Math.max(0.01, Math.min(0.99, marketProb + sentimentBias * 0.5 + (briefConfidence - 0.5) * 0.1)),
      gpt_bull: Math.max(0.01, Math.min(0.99, marketProb + Math.abs(narrativeGap) * 0.7 + (sentiment === 'bearish' ? -0.01 : 0.02))),
      gemini_bear: Math.max(0.01, Math.min(0.99, marketProb - Math.abs(narrativeGap) * 0.5 + (sentiment === 'bullish' ? 0.01 : -0.02))),
      deepseek_risk: Math.max(0.01, Math.min(0.99, marketProb + narrativeGap * 0.4 - Number(m.estimated_slippage || 0) * 0.25))
    };
    const llmEnsemble = await buildLlmEnsembleEstimate(m, brief, cfg, state.providers || {});
    const llmProvidersUsed = Object.keys(llmEnsemble.estimates || {});
    const modelProb = llmProvidersUsed.length
      ? Number(llmEnsemble.model_prob.toFixed(4))
      : Number(((heuristicEstimates.grok_primary * 0.3) + (heuristicEstimates.claude_news * 0.2) + (heuristicEstimates.gpt_bull * 0.2) + (heuristicEstimates.gemini_bear * 0.15) + (heuristicEstimates.deepseek_risk * 0.15)).toFixed(4));
    const estimateVals = Object.values(llmProvidersUsed.length ? llmEnsemble.estimates : heuristicEstimates);
    const mean = estimateVals.reduce((s, x) => s + x, 0) / Math.max(1, estimateVals.length);
    const stdDev = Math.sqrt(estimateVals.reduce((s, x) => s + ((x - mean) ** 2), 0) / Math.max(1, estimateVals.length));
    const edge = Number((modelProb - marketProb).toFixed(4));
    const deltaZ = Number((stdDev > 0 ? (edge / stdDev) : 0).toFixed(4));
    const b = marketProb > 0 ? (1 / marketProb) - 1 : 0;
    const expectedValue = Number(((modelProb * b) - (1 - modelProb)).toFixed(4));
    const confidence = Number(Math.max(0.05, Math.min(0.99, (1 - Math.min(0.5, stdDev)) * 0.55 + briefConfidence * 0.45)).toFixed(3));
    const actionable = Math.abs(edge) >= minEdge && confidence >= minConfidence;
    const direction = edge > 0 ? 'BUY_YES' : edge < 0 ? 'BUY_NO' : 'NO_TRADE';
    predictions.push({ time: new Date().toISOString(), market_id: m.id, question: m.question, source: m.platform || 'unknown', market_prob: marketProb, model_prob: Number(modelProb.toFixed(4)), edge, expected_value: expectedValue, mispricing_zscore: deltaZ, ensemble_std_dev: Number(stdDev.toFixed(4)), llm_estimates: Object.fromEntries(Object.entries(llmEnsemble.estimates || {}).map(([k, v]) => [k, Number(v.toFixed(4))])), llm_providers_used: llmProvidersUsed, llm_notes: llmEnsemble.notes || [], llm_rationales: llmEnsemble.rationales || {}, confidence: Number(confidence.toFixed(3)), actionable, direction: actionable ? direction : 'NO_TRADE' });
  }

  if (cfg.llm_enabled !== false && cfg.llm_require_provider === true && predictions.some((p) => !(p.llm_providers_used || []).length)) {
    throw new Error('llm_required_but_no_provider_response');
  }

  const actionableCount = predictions.filter((p) => p.actionable).length;
  const avgEdge = predictions.length ? predictions.reduce((s, p) => s + Math.abs(Number(p.edge || 0)), 0) / predictions.length : 0;
  const calibration = computeBrierCalibration(state.prediction_outcomes || []);

  state.predictions = predictions;
  state.prediction_log = [...predictions, ...(state.prediction_log || [])].slice(0, 2000);
  state.step3_summary = { completed_at: new Date().toISOString(), predicted_markets: predictions.length, avg_edge: Number(avgEdge.toFixed(4)), calibration_brier_score: calibration.brier_score, actionable_pct: Number((predictions.length ? (actionableCount / predictions.length) * 100 : 0).toFixed(1)) };
  state.predict_runs = state.predict_runs || [];
  state.predict_runs.unshift({ time: new Date().toISOString(), summary: state.step3_summary, predictions: predictions.length });
  state.predict_runs = state.predict_runs.slice(0, 100);
  saveState(state);
  return { predictions, summary: state.step3_summary, runs: state.predict_runs };
}

export function recordPredictionOutcomes(state, items = []) {
  state.prediction_outcomes = state.prediction_outcomes || [];
  const now = new Date().toISOString();
  for (const item of items) {
    const marketId = String(item.market_id || '');
    const outcome = Number(item.outcome);
    if (!marketId || ![0, 1].includes(outcome)) continue;
    const latestPred = (state.prediction_log || []).find((p) => String(p.market_id) === marketId);
    state.prediction_outcomes.unshift({ market_id: marketId, outcome, predicted_prob: Number(latestPred?.model_prob ?? item.predicted_prob ?? 0.5), recorded_at: now });
  }
  state.prediction_outcomes = state.prediction_outcomes.slice(0, 5000);
  saveState(state);
  return state.prediction_outcomes;
}
