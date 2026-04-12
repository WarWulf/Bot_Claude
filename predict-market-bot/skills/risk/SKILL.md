# Step 5 Skill: Risk

## Goal
Evaluate open exposure, enforce position limits, and block unsafe conditions before and during trading.

## How It Works
The risk step scans all open positions, checks each against configured limits, and flags violations. It runs both as a pipeline step and can be called independently via the Python risk validation script.

## Two Layers of Risk Management

### 1. JavaScript Risk Check (in-app)
Runs as Step 5 of the pipeline. Checks:
- Each open position's size vs max_pos_pct (default 5% of bankroll)
- Total exposure vs max_total_exposure_pct (default 50%)
- Outputs violation list and summary

### 2. Python Risk Validation (deterministic, 10 checks)
Run `scripts/validate_risk.py` — all checks must pass before any trade executes:
1. **Edge** ≥ 0.04 minimum
2. **Position size** ≤ Kelly Criterion calculation
3. **Position size** ≤ max 5% of bankroll
4. **Total exposure** within max limit
5. **Concurrent positions** < 15
6. **Drawdown hard stop** < 8% (blocks ALL new trades)
7. **Drawdown early warning** < 5% (pause new positions, reduce to ⅛ Kelly)
8. **Daily loss** < 15% threshold
9. **API cost** ≤ $50/day
10. **Slippage** ≤ 2%

## Early Warning System
When drawdown reaches 5%, the system should:
- Reduce position sizing from quarter-Kelly to one-eighth Kelly
- Pause adding new positions until drawdown recovers below 3%
- This prevents reaching the 8% hard stop where all trading is blocked

## Position Limits
- Max 5% of bankroll per single position
- Max 15 concurrent positions
- Max 50% total exposure (all open positions combined)
- Max 15% daily loss before automatic shutdown
- Max $50/day in AI API costs (prevents runaway token spending)

## Kelly Criterion Sizing
Use `scripts/kelly_size.py` for position calculations:
- **Full Kelly**: `f* = (p × b - q) / b` — mathematically optimal but extremely volatile
- **Quarter Kelly** (recommended): f* × 0.25 — consistent returns, low ruin risk
- Position is capped at max_pos_pct regardless of Kelly output

## Kill Switch
Setting kill_switch=true (via API or UI) immediately blocks all new orders. This is the emergency stop.

## Output
- `step5_summary` — checked positions, violations count, max position %, total exposure %
- `violations` — list of positions exceeding limits with issue descriptions

## Post-Trade Learning
After every trade settles:
- Log: entry price, exit price, predicted probability, actual outcome, P&L, time held
- Classify losses: bad prediction, bad timing, bad execution, or external shock
- Save lessons to `references/failure_log.md`
- The scan step reads failure_log.md before processing new markets

## Performance Targets
- Win rate: ≥ 60% for sustainable edge
- Sharpe Ratio: above 2.0
- Max Drawdown: block new trades if > 8%
- Profit Factor (gross profit / gross loss): above 1.5
- Brier Score: lower is better, target < 0.25
