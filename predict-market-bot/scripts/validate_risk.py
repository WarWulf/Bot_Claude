#!/usr/bin/env python3
"""
Deterministic risk validation for prediction market trades.
All checks must pass before a trade can execute.

Usage:
    python validate_risk.py --config risk_config.json --trade trade.json
    python validate_risk.py --edge 0.06 --position-pct 0.03 --new-exposure 500 \
        --existing-exposure 2000 --max-exposure 5000 --drawdown 0.03 \
        --daily-loss 0.05 --daily-api-cost 20
"""

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from typing import List, Optional


@dataclass
class RiskCheck:
    name: str
    passed: bool
    value: float
    threshold: float
    message: str


@dataclass
class RiskConfig:
    min_edge: float = 0.04
    max_position_pct: float = 0.05
    max_total_exposure: float = 5000.0
    max_concurrent_positions: int = 15
    max_drawdown: float = 0.08
    early_warning_drawdown: float = 0.05
    early_warning_kelly_fraction: float = 0.125  # 1/8 Kelly when in warning zone
    max_daily_loss_pct: float = 0.15
    max_daily_api_cost: float = 50.0
    max_slippage: float = 0.02
    var_95_daily_limit: float = 500.0


def validate_trade(
    edge: float,
    position_pct: float,
    kelly_pct: float,
    new_exposure: float,
    existing_exposure: float,
    current_drawdown: float,
    daily_loss_pct: float,
    daily_api_cost: float,
    num_positions: int = 0,
    slippage: float = 0.0,
    var_95: float = 0.0,
    config: Optional[RiskConfig] = None,
) -> dict:
    """
    Run all risk checks. Returns a dict with pass/fail for each check
    and an overall APPROVED or BLOCKED verdict.
    """
    if config is None:
        config = RiskConfig()

    checks: List[RiskCheck] = []

    # 1. Edge check
    checks.append(RiskCheck(
        name="edge",
        passed=edge >= config.min_edge,
        value=edge,
        threshold=config.min_edge,
        message=f"Edge {edge:.4f} {'≥' if edge >= config.min_edge else '<'} minimum {config.min_edge}",
    ))

    # 2. Position size vs Kelly
    checks.append(RiskCheck(
        name="kelly_size",
        passed=position_pct <= kelly_pct,
        value=position_pct,
        threshold=kelly_pct,
        message=f"Position {position_pct:.2%} {'≤' if position_pct <= kelly_pct else '>'} Kelly {kelly_pct:.2%}",
    ))

    # 3. Position size vs max
    checks.append(RiskCheck(
        name="max_position",
        passed=position_pct <= config.max_position_pct,
        value=position_pct,
        threshold=config.max_position_pct,
        message=f"Position {position_pct:.2%} {'≤' if position_pct <= config.max_position_pct else '>'} max {config.max_position_pct:.2%}",
    ))

    # 4. Total exposure
    total_exposure = new_exposure + existing_exposure
    checks.append(RiskCheck(
        name="total_exposure",
        passed=total_exposure <= config.max_total_exposure,
        value=total_exposure,
        threshold=config.max_total_exposure,
        message=f"Total exposure ${total_exposure:.2f} {'≤' if total_exposure <= config.max_total_exposure else '>'} max ${config.max_total_exposure:.2f}",
    ))

    # 5. Concurrent positions
    checks.append(RiskCheck(
        name="concurrent_positions",
        passed=num_positions < config.max_concurrent_positions,
        value=float(num_positions),
        threshold=float(config.max_concurrent_positions),
        message=f"Positions {num_positions} {'<' if num_positions < config.max_concurrent_positions else '≥'} max {config.max_concurrent_positions}",
    ))

    # 6. Drawdown (hard stop)
    checks.append(RiskCheck(
        name="drawdown",
        passed=current_drawdown < config.max_drawdown,
        value=current_drawdown,
        threshold=config.max_drawdown,
        message=f"Drawdown {current_drawdown:.2%} {'<' if current_drawdown < config.max_drawdown else '≥'} max {config.max_drawdown:.2%}",
    ))

    # 6b. Drawdown early warning — block new positions above 5%
    checks.append(RiskCheck(
        name="drawdown_early_warning",
        passed=current_drawdown < config.early_warning_drawdown,
        value=current_drawdown,
        threshold=config.early_warning_drawdown,
        message=f"Drawdown {current_drawdown:.2%} {'<' if current_drawdown < config.early_warning_drawdown else '≥'} early warning {config.early_warning_drawdown:.2%} (pause new positions, use 1/8 Kelly)",
    ))

    # 7. Daily loss
    checks.append(RiskCheck(
        name="daily_loss",
        passed=daily_loss_pct < config.max_daily_loss_pct,
        value=daily_loss_pct,
        threshold=config.max_daily_loss_pct,
        message=f"Daily loss {daily_loss_pct:.2%} {'<' if daily_loss_pct < config.max_daily_loss_pct else '≥'} max {config.max_daily_loss_pct:.2%}",
    ))

    # 8. API cost
    checks.append(RiskCheck(
        name="api_cost",
        passed=daily_api_cost <= config.max_daily_api_cost,
        value=daily_api_cost,
        threshold=config.max_daily_api_cost,
        message=f"API cost ${daily_api_cost:.2f} {'≤' if daily_api_cost <= config.max_daily_api_cost else '>'} max ${config.max_daily_api_cost:.2f}",
    ))

    # 9. Slippage
    checks.append(RiskCheck(
        name="slippage",
        passed=slippage <= config.max_slippage,
        value=slippage,
        threshold=config.max_slippage,
        message=f"Slippage {slippage:.2%} {'≤' if slippage <= config.max_slippage else '>'} max {config.max_slippage:.2%}",
    ))

    # 10. VaR
    if var_95 > 0:
        checks.append(RiskCheck(
            name="var_95",
            passed=var_95 <= config.var_95_daily_limit,
            value=var_95,
            threshold=config.var_95_daily_limit,
            message=f"VaR(95%) ${var_95:.2f} {'≤' if var_95 <= config.var_95_daily_limit else '>'} limit ${config.var_95_daily_limit:.2f}",
        ))

    all_passed = all(c.passed for c in checks)

    return {
        "verdict": "APPROVED" if all_passed else "BLOCKED",
        "checks": [asdict(c) for c in checks],
        "passed": sum(1 for c in checks if c.passed),
        "failed": sum(1 for c in checks if not c.passed),
        "total": len(checks),
    }


def main():
    # Mode 1: Backend API call — `python3 validate_risk.py --json '{"edge":0.06,...}'`
    if len(sys.argv) == 3 and sys.argv[1] == "--json":
        try:
            payload = json.loads(sys.argv[2])
        except json.JSONDecodeError:
            print(json.dumps({"error": "invalid JSON payload"}))
            sys.exit(1)

        config = RiskConfig()
        for k, v in payload.items():
            if hasattr(config, k):
                setattr(config, k, type(getattr(config, k))(v))

        result = validate_trade(
            edge=float(payload.get("edge", 0)),
            position_pct=float(payload.get("position_pct", 0)),
            kelly_pct=float(payload.get("kelly_pct", 0.05)),
            new_exposure=float(payload.get("new_exposure", 0)),
            existing_exposure=float(payload.get("existing_exposure", 0)),
            current_drawdown=float(payload.get("drawdown", 0)),
            daily_loss_pct=float(payload.get("daily_loss", 0)),
            daily_api_cost=float(payload.get("daily_api_cost", 0)),
            num_positions=int(payload.get("num_positions", 0)),
            slippage=float(payload.get("slippage", 0)),
            var_95=float(payload.get("var_95", 0)),
            config=config,
        )
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["verdict"] == "APPROVED" else 1)

    # Mode 2: CLI — `python3 validate_risk.py --edge 0.06 --position-pct 0.03 ...`
    parser = argparse.ArgumentParser(description="Validate trade risk")
    parser.add_argument("--edge", type=float, required=True)
    parser.add_argument("--position-pct", type=float, required=True, help="Position as fraction of bankroll")
    parser.add_argument("--kelly-pct", type=float, default=0.05, help="Kelly-calculated max fraction")
    parser.add_argument("--new-exposure", type=float, required=True, help="Dollar exposure of new trade")
    parser.add_argument("--existing-exposure", type=float, default=0.0)
    parser.add_argument("--drawdown", type=float, default=0.0, help="Current drawdown as fraction")
    parser.add_argument("--daily-loss", type=float, default=0.0, help="Daily loss as fraction")
    parser.add_argument("--daily-api-cost", type=float, default=0.0)
    parser.add_argument("--num-positions", type=int, default=0)
    parser.add_argument("--slippage", type=float, default=0.0)
    parser.add_argument("--var-95", type=float, default=0.0)
    parser.add_argument("--config", type=str, default=None, help="JSON config file")
    parser.add_argument("--output-json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    config = RiskConfig()
    if args.config:
        with open(args.config) as f:
            cfg = json.load(f)
            for k, v in cfg.items():
                if hasattr(config, k):
                    setattr(config, k, v)

    result = validate_trade(
        edge=args.edge,
        position_pct=args.position_pct,
        kelly_pct=args.kelly_pct,
        new_exposure=args.new_exposure,
        existing_exposure=args.existing_exposure,
        current_drawdown=args.drawdown,
        daily_loss_pct=args.daily_loss,
        daily_api_cost=args.daily_api_cost,
        num_positions=args.num_positions,
        slippage=args.slippage,
        var_95=args.var_95,
        config=config,
    )

    if args.output_json:
        print(json.dumps(result, indent=2))
    else:
        print(f"\n=== Risk Validation: {result['verdict']} ===")
        print(f"Passed {result['passed']}/{result['total']} checks\n")
        for check in result["checks"]:
            status = "✓" if check["passed"] else "✗"
            print(f"  {status} {check['message']}")
        print()

    sys.exit(0 if result["verdict"] == "APPROVED" else 1)


if __name__ == "__main__":
    main()
