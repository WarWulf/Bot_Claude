# Step 4 Skill: Execute

## Goal
Transform actionable predictions into executable orders, routing through paper trading or (future) live exchange APIs.

## How It Works
The execution step takes all actionable predictions from Step 3, validates each against risk/exposure limits, and creates orders. Currently supports paper trading mode; live routing is planned.

## Execution Flow
1. Filter predictions to only those flagged `actionable` with a valid `direction` (BUY_YES or BUY_NO)
2. For each signal, check the kill switch — if active, skip
3. Calculate position size using `computePaperPositionUsd()` (bankroll × paper_trade_risk_pct, default 2%)
4. Run exposure check: new position + existing open exposure must not exceed max_total_exposure_pct
5. If checks pass, create an order record with status PAPER_EXECUTED (or READY_TO_ROUTE for live)
6. In paper mode, also create a trade record with status OPEN

## Position Sizing
Default paper trading size: 2% of bankroll per position. For production, use `scripts/kelly_size.py` for Kelly Criterion sizing.

Use Fractional Kelly (0.25–0.5×) rather than Full Kelly. Quarter-Kelly produces more consistent returns with far less risk of ruin.

## Risk Checks Before Execution
- Kill switch not active
- Position size within max_pos_pct (default 5% of bankroll)
- Total open exposure within max_total_exposure_pct (default 50%)
- Max concurrent positions not exceeded (default 15)

## Kill Switch
Creating a file called `STOP` or setting kill_switch=true via the API immediately blocks all new orders. Existing positions remain open but no new trades are placed.

## Execution Rules (for future live routing)
- Use limit orders, not market orders, to control slippage
- Abort if price moves >2% between signal and fill
- Auto-hedge if conditions shift before settlement

## Output
- `orders` — order records with id, market, direction, edge, position size, status
- `step4_summary` — candidate signals, executed orders, skipped, risk-blocked, total exposure, paper mode flag
