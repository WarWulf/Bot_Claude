# Prediction Market Bot — Skills

Each pipeline stage has its own SKILL.md that tells Claude how to handle that step.

| Skill | File | Purpose |
|-------|------|---------|
| Scan | `skills/scan/SKILL.md` | Filter and rank tradeable markets |
| Research | `skills/research/SKILL.md` | Multi-source intelligence gathering |
| Predict | `skills/predict/SKILL.md` | LLM ensemble probability estimation |
| Execute | `skills/execute/SKILL.md` | Order routing and paper trading |
| Risk | `skills/risk/SKILL.md` | Position limits, Kelly sizing, drawdown guards |

## Bundled Scripts
- `scripts/kelly_size.py` — Kelly Criterion position sizing (CLI + JSON)
- `scripts/validate_risk.py` — 10-check deterministic risk gate
- `scripts/market_connector.py` — Polymarket + Kalshi API client
- `scripts/trade_logger.py` — Trade logging + dashboard export

## References
- `references/formulas.md` — All math formulas
- `references/platforms.md` — Platform API docs
- `references/failure_log.md` — Post-trade lessons (grows over time)
