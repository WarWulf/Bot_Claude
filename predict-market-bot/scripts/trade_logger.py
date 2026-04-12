#!/usr/bin/env python3
"""
Trade logger — records trades and exports dashboard-ready JSON.

This is the bridge between your bot's live activity and the dashboard.
It stores trades in a local JSON file and exports the format the
React dashboard expects.

Usage:
    # Log a new trade
    python trade_logger.py log --market "Fed Rate Hold" --platform kalshi \
        --entry 0.42 --p-model 0.68 --size 250

    # Record trade outcome
    python trade_logger.py resolve --id 1 --outcome won --exit 1.0

    # Export for dashboard
    python trade_logger.py export --output dashboard_data.json

    # Show current portfolio summary
    python trade_logger.py status
"""

import argparse
import json
import os
import sys
from datetime import datetime
from dataclasses import dataclass, asdict, field
from typing import List, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "trades.json")


@dataclass
class Trade:
    id: int
    market: str
    platform: str
    entry: float
    exit: Optional[float]
    p_model: float
    outcome: Optional[int]  # 1 = yes, 0 = no, None = open
    pnl: Optional[float]
    size: float
    date: str
    status: str  # "open", "won", "lost"
    edge: float = 0.0
    notes: str = ""


def load_db() -> List[dict]:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if os.path.exists(DB_PATH):
        with open(DB_PATH) as f:
            return json.load(f)
    return []


def save_db(trades: List[dict]):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with open(DB_PATH, "w") as f:
        json.dump(trades, f, indent=2)


def log_trade(market, platform, entry, p_model, size, notes=""):
    trades = load_db()
    next_id = max([t["id"] for t in trades], default=0) + 1
    edge = p_model - entry

    trade = Trade(
        id=next_id,
        market=market,
        platform=platform,
        entry=entry,
        exit=None,
        p_model=p_model,
        outcome=None,
        pnl=None,
        size=size,
        date=datetime.now().strftime("%Y-%m-%d"),
        status="open",
        edge=round(edge, 4),
        notes=notes,
    )
    trades.append(asdict(trade))
    save_db(trades)
    print(f"Logged trade #{next_id}: {market} ({platform}) @ {entry:.2f}, model={p_model:.2f}, edge={edge:.2f}, size=${size}")
    return next_id


def resolve_trade(trade_id, outcome_str, exit_price):
    trades = load_db()
    found = False
    for t in trades:
        if t["id"] == trade_id:
            t["exit"] = exit_price
            if outcome_str == "won":
                t["outcome"] = 1
                t["status"] = "won"
                t["pnl"] = round((exit_price - t["entry"]) * (t["size"] / t["entry"]), 2)
            else:
                t["outcome"] = 0
                t["status"] = "lost"
                t["pnl"] = round(-t["size"], 2)
            found = True
            print(f"Resolved trade #{trade_id}: {t['status']}, P&L=${t['pnl']}")
            break
    if not found:
        print(f"Trade #{trade_id} not found")
        return
    save_db(trades)


def export_dashboard(output_path):
    trades = load_db()
    closed = [t for t in trades if t["status"] != "open"]
    open_pos = [t for t in trades if t["status"] == "open"]

    # Calculate metrics
    if closed:
        wins = sum(1 for t in closed if t["pnl"] and t["pnl"] > 0)
        total_pnl = sum(t["pnl"] or 0 for t in closed)
        gross_profit = sum(t["pnl"] for t in closed if t["pnl"] and t["pnl"] > 0)
        gross_loss = abs(sum(t["pnl"] for t in closed if t["pnl"] and t["pnl"] < 0))
        win_rate = wins / len(closed) if closed else 0
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")

        # Brier score
        brier = sum((t["p_model"] - (t["outcome"] or 0)) ** 2 for t in closed) / len(closed)
    else:
        win_rate = 0
        total_pnl = 0
        profit_factor = 0
        brier = 0

    dashboard = {
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "total_trades": len(closed),
            "open_positions": len(open_pos),
            "win_rate": round(win_rate, 4),
            "total_pnl": round(total_pnl, 2),
            "profit_factor": round(profit_factor, 4) if profit_factor != float("inf") else "Infinity",
            "brier_score": round(brier, 4),
        },
        "closed_trades": closed,
        "open_positions": [
            {
                "market": t["market"],
                "platform": t["platform"],
                "entry": t["entry"],
                "current": t["entry"],  # You'd update this with live price
                "pModel": t["p_model"],
                "edge": t["edge"],
                "size": t["size"],
            }
            for t in open_pos
        ],
    }

    with open(output_path, "w") as f:
        json.dump(dashboard, f, indent=2)
    print(f"Dashboard data exported to {output_path}")
    print(f"  {len(closed)} closed trades, {len(open_pos)} open positions")
    print(f"  Win rate: {win_rate:.1%}, Total P&L: ${total_pnl:.2f}, Brier: {brier:.3f}")


def show_status():
    trades = load_db()
    open_pos = [t for t in trades if t["status"] == "open"]
    closed = [t for t in trades if t["status"] != "open"]

    total_pnl = sum(t["pnl"] or 0 for t in closed)
    total_exposure = sum(t["size"] for t in open_pos)

    print(f"\n=== Portfolio Status ===")
    print(f"Closed trades: {len(closed)}")
    print(f"Open positions: {len(open_pos)}")
    print(f"Total P&L: ${total_pnl:.2f}")
    print(f"Total exposure: ${total_exposure:.2f}")

    if open_pos:
        print(f"\nOpen:")
        for t in open_pos:
            print(f"  #{t['id']} {t['market']} ({t['platform']}) @ {t['entry']:.2f}, model={t['p_model']:.2f}, ${t['size']}")

    if closed:
        wins = sum(1 for t in closed if t["pnl"] and t["pnl"] > 0)
        print(f"\nWin rate: {wins}/{len(closed)} ({wins/len(closed):.1%})")
    print()


def main():
    parser = argparse.ArgumentParser(description="Trade Logger")
    sub = parser.add_subparsers(dest="command")

    log_p = sub.add_parser("log", help="Log a new trade")
    log_p.add_argument("--market", required=True)
    log_p.add_argument("--platform", choices=["polymarket", "kalshi"], required=True)
    log_p.add_argument("--entry", type=float, required=True)
    log_p.add_argument("--p-model", type=float, required=True)
    log_p.add_argument("--size", type=float, required=True)
    log_p.add_argument("--notes", default="")

    res_p = sub.add_parser("resolve", help="Record trade outcome")
    res_p.add_argument("--id", type=int, required=True)
    res_p.add_argument("--outcome", choices=["won", "lost"], required=True)
    res_p.add_argument("--exit", type=float, required=True)

    exp_p = sub.add_parser("export", help="Export dashboard JSON")
    exp_p.add_argument("--output", default="dashboard_data.json")

    sub.add_parser("status", help="Show portfolio status")

    args = parser.parse_args()

    if args.command == "log":
        log_trade(args.market, args.platform, args.entry, args.p_model, args.size, args.notes)
    elif args.command == "resolve":
        resolve_trade(args.id, args.outcome, args.exit)
    elif args.command == "export":
        export_dashboard(args.output)
    elif args.command == "status":
        show_status()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
