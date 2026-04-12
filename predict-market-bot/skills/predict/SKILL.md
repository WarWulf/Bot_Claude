# Step 3 Skill: Predict

## Goal
Estimate true event probabilities and identify market mispricings by combining heuristic models with an LLM ensemble.

## How It Works
For each top market, the prediction step runs two layers:
1. **Heuristic ensemble** — five model personas with different biases, weighted and averaged
2. **LLM ensemble** (optional) — queries up to 4 real LLM providers, weighted by confidence

If LLM providers are configured and responding, their output overrides the heuristic. If not, the heuristic serves as a reliable fallback.

## Heuristic Ensemble (5 Personas)
- **grok_primary** (30%) — main forecaster, uses stance + sentiment + narrative gap
- **claude_news** (20%) — news analyst, sentiment-weighted with confidence adjustment
- **gpt_bull** (20%) — bull advocate, amplifies positive narrative gaps
- **gemini_bear** (15%) — bear advocate, dampens narrative gaps
- **deepseek_risk** (15%) — risk manager, penalizes for slippage

Each persona produces an independent probability estimate. The weighted average becomes the heuristic model probability.

## LLM Ensemble (4 Providers)
Configurable in Settings with individual weights:
- **OpenAI** (default weight 0.35) — GPT-4o-mini or similar
- **Claude** (default weight 0.25) — via Anthropic API
- **Gemini** (default weight 0.20) — via Google AI API
- **Ollama Cloud** (default weight 0.20) — kimi-k2.5 or custom

Each provider receives a standardized prompt asking for strict JSON with `probability_yes`, `confidence`, and `rationale`. Responses are parsed, clamped to 0.01–0.99, and weighted by both their configured weight and their self-reported confidence.

## Core Formulas
- **Edge**: `edge = model_prob - market_price` — only actionable when |edge| ≥ min_edge (default 0.04)
- **Expected Value**: `EV = model_prob × b - (1 - model_prob)` where b = (1/market_price) - 1
- **Mispricing z-score**: `delta = edge / std_dev` — how many standard deviations the model diverges from the market
- **Confidence gate**: a trade signal is only generated when both edge and confidence exceed their thresholds

## Calibration Tracking
Every prediction is logged. When outcomes are recorded (via `/api/predict/outcomes`), the system computes:
- **Brier Score**: `BS = (1/n) × Σ(predicted - outcome)²` — target below 0.25
- Calibration data is shown in the UI and used to assess whether the model is over/underconfident

## Output
- `predictions` — per-market: model_prob, edge, EV, z-score, direction (BUY_YES/BUY_NO/NO_TRADE), actionable flag
- `step3_summary` — aggregate stats: avg edge, actionable %, Brier score

## Rules
- Never generate a trade signal below the confidence threshold
- Log every prediction for post-analysis
- If `llm_require_provider` is true and no LLM responds, the step throws an error rather than falling back to heuristics
