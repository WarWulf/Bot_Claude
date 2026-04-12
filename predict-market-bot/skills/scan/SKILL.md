# Step 1 Skill: Scan

## Goal
Find tradeable prediction markets with sufficient liquidity, volume, and anomaly potential across Polymarket and Kalshi.

## How It Works
The scanner connects to both platform APIs, fetches active markets, and applies a multi-layer filter pipeline. Markets that pass all filters get ranked by an opportunity score combining anomalies, volume, and liquidity.

## Inputs
- `config` — scanner thresholds, active hours, top_n, source selection
- Platform credentials for Polymarket (EIP-712 wallet signing) and Kalshi (HMAC key signing)

## Filter Pipeline
All filters are configurable in the UI Settings panel:
- **Volume**: minimum contract volume (default 200, production preset 50,000)
- **Liquidity**: minimum orderbook depth (default 200, production preset 10,000)
- **Expiry**: max days to resolution (default 30)
- **Spread**: flag markets with spread > 5¢ as anomalies
- **Slippage**: estimate and reject markets with slippage > 2%
- **Price range**: only consider markets between 5¢ and 95¢ (avoid near-certain outcomes with tail risk)

## Anomaly Detection
Markets get flagged and scored for:
- **Sudden price move** (>10% from previous scan) — 40 points
- **Wide spread** (>5¢) — 30 points
- **Volume spike** (>2× the 7-day rolling average) — 30 points
- Plus bonus points for raw volume and liquidity depth

## History Enrichment
The scanner maintains a 14-day rolling history of price and volume per market. This enables accurate 7-day volume averages and price change detection across scan cycles, not just within a single snapshot.

## Circuit Breaker
If the scanner fails 3 consecutive times (configurable), it enters a cooldown period (default 300 seconds) to avoid hammering failing APIs. The breaker auto-resets after cooldown.

## Before Scanning
Always read `references/failure_log.md` and skip markets or patterns that match past failures. This prevents the bot from repeating known mistakes.

## Output
- `scan_results` — ranked list of tradeable markets, capped at top_n
- `scan_runs` — metadata per scan cycle (timing, coverage, counts)
- `scan_audit_log` — detailed event log for debugging

## Schedule
Runs every 15–30 minutes during active hours (configurable UTC range). Can also be triggered manually via `/api/scan/run`.

## Self-Test
The `/api/scan/self-test` endpoint validates scheduler config, circuit breaker state, auth credentials, scan freshness, and tradeable count against targets.
