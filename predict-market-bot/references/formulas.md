# Formulas Reference

## Edge & Expected Value

**Market Edge:**
```
edge = p_model - p_market
```
Only trade when edge > 0.04.

**Expected Value per dollar risked:**
```
EV = p × b - (1 - p)
```
Where `p` = your model's probability, `b` = net odds = (1/market_price) - 1.

**Mispricing Score (z-score):**
```
delta = (p_model - p_market) / std_dev
```
Higher absolute value = stronger signal.

## Kelly Criterion

**Full Kelly fraction:**
```
f* = (p × b - q) / b
```
Where `p` = win probability, `q` = 1 - p, `b` = net odds.

**Fractional Kelly:** Multiply f* by 0.25–0.5 for practical use. Full Kelly maximizes long-run growth but has extreme variance.

**Example:** $10,000 bankroll, 70% win probability, 2:1 odds.
- Full Kelly: f* = (0.7×2 - 0.3)/2 = 0.55 → 55% → way too aggressive
- Wait — that's the raw fraction. With prediction market odds where b = (1/market_price)-1, recalculate accordingly.
- Quarter-Kelly: f* × 0.25 → much safer, more consistent returns.

## Calibration

**Brier Score:**
```
BS = (1/n) × Σ(predicted_i - outcome_i)²
```
- outcome = 1 if event happened, 0 if not
- Lower is better. Target below 0.25.
- A perfectly calibrated model's 70% predictions come true 70% of the time.

## Risk Metrics

**Sharpe Ratio:**
```
Sharpe = (mean_return - risk_free_rate) / std_dev_return
```
Target above 2.0.

**Profit Factor:**
```
PF = gross_profit / gross_loss
```
Healthy bot maintains above 1.5.

**Value at Risk (VaR 95%):**
The maximum expected loss at 95% confidence over a given period. Keep within daily limit.

**Max Drawdown:**
Largest peak-to-trough decline in portfolio value. Block all new trades if it exceeds 8%.
