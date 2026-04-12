#!/usr/bin/env python3
"""
Kelly Criterion position sizing for prediction market trades.

Usage:
    python kelly_size.py --probability 0.70 --odds 2.0 --bankroll 10000 --fraction 0.25
    python kelly_size.py -p 0.70 -o 2.0 -b 10000 -f 0.25
"""

import argparse
import json
import sys


def kelly_fraction(p: float, b: float) -> float:
    """
    Calculate the full Kelly fraction.

    Args:
        p: Probability of winning (0 < p < 1)
        b: Net odds received on the bet (decimal odds - 1).
           For prediction markets: b = (1 / market_price) - 1

    Returns:
        Optimal fraction of bankroll to bet (can be negative = don't bet)
    """
    q = 1.0 - p
    if b <= 0:
        return 0.0
    return (p * b - q) / b


def size_position(
    probability: float,
    market_price: float = None,
    odds: float = None,
    bankroll: float = 10000.0,
    fraction: float = 0.25,
    max_pct: float = 0.05,
) -> dict:
    """
    Calculate position size using fractional Kelly Criterion.

    Args:
        probability: Your estimated probability of the event (0-1)
        market_price: Current market price (0-1). Used to derive odds if odds not given.
        odds: Net odds (decimal odds - 1). Overrides market_price if both provided.
        bankroll: Total bankroll in dollars
        fraction: Kelly fraction multiplier (0.25 = quarter-Kelly)
        max_pct: Maximum percentage of bankroll per position

    Returns:
        Dict with sizing details
    """
    if probability <= 0 or probability >= 1:
        return {"error": "Probability must be between 0 and 1 exclusive"}

    # Derive odds from market price if not explicitly given
    if odds is None:
        if market_price is None or market_price <= 0 or market_price >= 1:
            return {"error": "Provide either odds or a valid market_price (0-1)"}
        odds = (1.0 / market_price) - 1.0

    edge = probability - (1.0 / (1.0 + odds))  # edge vs implied probability
    full_kelly = kelly_fraction(probability, odds)
    fractional_kelly = full_kelly * fraction

    # Clamp to max position size
    position_pct = min(max(fractional_kelly, 0.0), max_pct)
    position_dollars = round(position_pct * bankroll, 2)

    ev = probability * odds - (1.0 - probability)

    return {
        "probability": probability,
        "odds": round(odds, 4),
        "edge": round(edge, 4),
        "full_kelly_pct": round(full_kelly * 100, 2),
        "fractional_kelly_pct": round(fractional_kelly * 100, 2),
        "capped_pct": round(position_pct * 100, 2),
        "position_dollars": position_dollars,
        "expected_value_per_dollar": round(ev, 4),
        "fraction_used": fraction,
        "bankroll": bankroll,
        "recommendation": "TRADE" if edge > 0.04 and position_dollars > 0 else "NO TRADE",
    }


def main():
    parser = argparse.ArgumentParser(description="Kelly Criterion position sizing")
    parser.add_argument("-p", "--probability", type=float, required=True, help="Your estimated win probability (0-1)")
    parser.add_argument("-m", "--market-price", type=float, default=None, help="Current market price (0-1)")
    parser.add_argument("-o", "--odds", type=float, default=None, help="Net odds (decimal odds - 1)")
    parser.add_argument("-b", "--bankroll", type=float, default=10000.0, help="Total bankroll in dollars")
    parser.add_argument("-f", "--fraction", type=float, default=0.25, help="Kelly fraction (0.25 = quarter-Kelly)")
    parser.add_argument("--max-pct", type=float, default=0.05, help="Max pct of bankroll per position")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    result = size_position(
        probability=args.probability,
        market_price=args.market_price,
        odds=args.odds,
        bankroll=args.bankroll,
        fraction=args.fraction,
        max_pct=args.max_pct,
    )

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if "error" in result:
            print(f"Error: {result['error']}")
            sys.exit(1)
        print(f"=== Kelly Position Sizing ===")
        print(f"Win probability:     {result['probability']:.1%}")
        print(f"Odds (net):          {result['odds']:.4f}")
        print(f"Edge:                {result['edge']:.4f}")
        print(f"Full Kelly:          {result['full_kelly_pct']:.2f}%")
        print(f"Fractional Kelly:    {result['fractional_kelly_pct']:.2f}% ({result['fraction_used']}x)")
        print(f"Capped at:           {result['capped_pct']:.2f}%")
        print(f"Position size:       ${result['position_dollars']:.2f} of ${result['bankroll']:.2f}")
        print(f"EV per dollar:       {result['expected_value_per_dollar']:.4f}")
        print(f"Recommendation:      {result['recommendation']}")


if __name__ == "__main__":
    main()
