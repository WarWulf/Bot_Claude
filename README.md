# Prediction Market Trading Bot — V4.0 (Refactored)

AI-powered prediction market trading bot with a modular Node.js backend, React dashboard, and Claude skill integration.

## What Changed in V4.0

The 2,200-line monolithic `index.js` has been split into focused modules:

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `index.js` | ~190 | Entry point + route registration |
| `utils.js` | ~110 | HTTP retry, JSON parsing, sentiment, live comm log |
| `auth.js` | ~60 | UI password auth + middleware |
| `platforms.js` | ~130 | Polymarket + Kalshi API clients |
| `websockets.js` | ~70 | WebSocket connection management |
| `scanner.js` | ~160 | Market scanning, filtering, ranking, scheduling |
| `research.js` | ~100 | Multi-source research pipeline |
| `predict.js` | ~130 | LLM ensemble + prediction step |
| `execution.js` | ~45 | Order execution + paper trading |
| `riskEngine.js` | ~25 | Risk validation step |
| `pipeline.js` | ~120 | Pipeline orchestration + step status |
| `config.js` | ~50 | Config sanitization + presets |
| `appState.js` | ~260 | State persistence (unchanged) |
| `scanCore.js` | ~23 | Pure scan helpers (unchanged) |
| `tradeEngine.js` | ~24 | Position sizing helpers (unchanged) |

### Also new:
- **Enriched SKILL.md files** — each pipeline stage now has detailed Claude skill docs (was 12–17 lines, now 40–90 lines each)
- **5% drawdown early warning** in `validate_risk.py` (10 checks instead of 9)
- **market_connector.py** — standalone scanner with both platform APIs
- **trade_logger.py** — CLI trade logging + dashboard JSON export

## Quick Start

```bash
# 1. Copy env file and add your API keys
cp .env.example .env

# 2. Start with Docker
docker compose up -d

# 3. Open the UI
open http://localhost:5173
```

## Architecture

```
Frontend (React + Vite)
    ↓ REST API
Backend (Node.js + Express)
    ├── Scanner → Polymarket + Kalshi APIs
    ├── Research → RSS / Reddit / NewsAPI / GDELT / X
    ├── Predict → LLM Ensemble (OpenAI / Claude / Gemini / Ollama)
    ├── Execute → Paper Trading / Order Routing
    └── Risk → Kelly Sizing + 10-Check Validation
```

## API Endpoints

### Pipeline
- `POST /api/pipeline/run` — Run full 5-step pipeline
- `GET /api/pipeline/status` — Pipeline status + step progress

### Individual Steps
- `POST /api/scan/run` — Trigger market scan
- `POST /api/research/run` — Run research step
- `POST /api/predict/run` — Run prediction step
- `POST /api/execute/run` — Run execution step
- `POST /api/risk/run` — Run risk check
- `POST /api/risk/validate` — Python risk validation (deterministic)

### Controls
- `POST /api/kill-switch` — Emergency stop
- `POST /api/save` — Save config + provider credentials
- `GET /api/connection/test` — Test platform connectivity

## Risk Management

The bot enforces strict risk limits at two levels:

**JavaScript (in-app):** position size %, total exposure %, concurrent positions
**Python (deterministic):** 10 checks including Kelly sizing, drawdown hard stop (8%), drawdown early warning (5%), daily loss limit, API cost cap

See `predict-market-bot/skills/risk/SKILL.md` for full details.

## Disclaimer

This is for educational and research purposes only. Trading involves real financial risk. Always start with paper trading. Never trade money you can't afford to lose.
