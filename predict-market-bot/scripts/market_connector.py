#!/usr/bin/env python3
"""
Market connector for Polymarket and Kalshi.
Fetches live market data and writes JSON for the dashboard to consume.

Setup:
    pip install requests websockets py_clob_client

Environment variables needed:
    POLYMARKET_API_KEY    - Your Polymarket API key
    POLYMARKET_SECRET     - Your Polymarket API secret  
    POLYMARKET_PASSPHRASE - Your Polymarket passphrase
    KALSHI_EMAIL          - Your Kalshi login email
    KALSHI_PASSWORD       - Your Kalshi password
    KALSHI_API_BASE       - "https://demo-api.kalshi.co/trade-api/v2" for demo,
                            "https://trading-api.kalshi.com/trade-api/v2" for live

Usage:
    # Fetch markets from both platforms
    python market_connector.py scan

    # Fetch a specific market's orderbook
    python market_connector.py orderbook --market-id <id> --platform polymarket

    # Run continuous scanner (every 15 min)
    python market_connector.py watch

    # Export data as JSON for the dashboard
    python market_connector.py scan --output markets.json
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from typing import List, Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCAN_INTERVAL_MINUTES = 15
MIN_VOLUME = 200
MAX_DAYS_TO_EXPIRY = 30
ANOMALY_PRICE_MOVE = 0.10
ANOMALY_SPREAD = 0.05


@dataclass
class Market:
    id: str
    title: str
    platform: str  # "polymarket" or "kalshi"
    price_yes: float
    price_no: float
    volume: int
    liquidity: float
    end_date: str
    category: str
    spread: float
    anomalies: list
    url: str


# ---------------------------------------------------------------------------
# Polymarket Client
# ---------------------------------------------------------------------------

class PolymarketClient:
    """
    Connects to Polymarket's CLOB API.
    
    Docs: https://docs.polymarket.com
    
    Authentication uses API key credentials (not wallet signing for read-only).
    For trading, you'll need the py_clob_client library:
        pip install py_clob_client
    """

    BASE_URL = "https://clob.polymarket.com"

    def __init__(self):
        self.api_key = os.environ.get("POLYMARKET_API_KEY")
        self.secret = os.environ.get("POLYMARKET_SECRET")
        self.passphrase = os.environ.get("POLYMARKET_PASSPHRASE")
        # Import here so the script doesn't crash if not installed
        try:
            import requests
            self.session = requests.Session()
        except ImportError:
            print("ERROR: pip install requests")
            sys.exit(1)

    def _headers(self):
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["POLY_API_KEY"] = self.api_key
            h["POLY_API_SECRET"] = self.secret or ""
            h["POLY_API_PASSPHRASE"] = self.passphrase or ""
        return h

    def fetch_markets(self, category: str = None) -> List[dict]:
        """Fetch active markets. Paginated — fetches all pages."""
        markets = []
        next_cursor = ""
        while True:
            url = f"{self.BASE_URL}/markets"
            params = {"limit": 100}
            if next_cursor:
                params["next_cursor"] = next_cursor
            resp = self.session.get(url, headers=self._headers(), params=params)
            resp.raise_for_status()
            data = resp.json()
            for m in data.get("data", data if isinstance(data, list) else []):
                if category and category.lower() not in m.get("category", "").lower():
                    continue
                markets.append(m)
            next_cursor = data.get("next_cursor", "")
            if not next_cursor or next_cursor == "LTE=":
                break
        return markets

    def get_orderbook(self, token_id: str) -> dict:
        """Fetch orderbook for a specific token."""
        url = f"{self.BASE_URL}/book"
        resp = self.session.get(url, headers=self._headers(), params={"token_id": token_id})
        resp.raise_for_status()
        return resp.json()

    def parse_market(self, raw: dict) -> Optional[Market]:
        """Convert raw Polymarket response to Market dataclass."""
        try:
            tokens = raw.get("tokens", [])
            yes_token = next((t for t in tokens if t.get("outcome") == "Yes"), {})
            no_token = next((t for t in tokens if t.get("outcome") == "No"), {})
            price_yes = float(yes_token.get("price", 0))
            price_no = float(no_token.get("price", 0))
            spread = abs(1.0 - price_yes - price_no)
            volume = int(raw.get("volume", 0))

            anomalies = []
            if spread > ANOMALY_SPREAD:
                anomalies.append("wide_spread")
            # Note: price_change_24h not always available, skip if missing

            return Market(
                id=raw.get("condition_id", raw.get("id", "")),
                title=raw.get("question", raw.get("title", "Unknown")),
                platform="polymarket",
                price_yes=price_yes,
                price_no=price_no,
                volume=volume,
                liquidity=float(raw.get("liquidity", 0)),
                end_date=raw.get("end_date_iso", ""),
                category=raw.get("category", ""),
                spread=spread,
                anomalies=anomalies,
                url=f"https://polymarket.com/event/{raw.get('slug', raw.get('condition_id', ''))}",
            )
        except Exception as e:
            print(f"  [skip] Could not parse Polymarket market: {e}")
            return None


# ---------------------------------------------------------------------------
# Kalshi Client
# ---------------------------------------------------------------------------

class KalshiClient:
    """
    Connects to Kalshi's REST API.
    
    Docs: https://trading-api.readme.io
    
    For testing, use the demo environment:
        KALSHI_API_BASE=https://demo-api.kalshi.co/trade-api/v2
    
    For live trading:
        KALSHI_API_BASE=https://trading-api.kalshi.com/trade-api/v2
    """

    def __init__(self):
        self.base_url = os.environ.get(
            "KALSHI_API_BASE",
            "https://demo-api.kalshi.co/trade-api/v2"  # Default to demo
        )
        self.email = os.environ.get("KALSHI_EMAIL")
        self.password = os.environ.get("KALSHI_PASSWORD")
        self.token = None
        try:
            import requests
            self.session = requests.Session()
        except ImportError:
            print("ERROR: pip install requests")
            sys.exit(1)

    def login(self):
        """Authenticate and get session token."""
        if not self.email or not self.password:
            print("WARNING: KALSHI_EMAIL and KALSHI_PASSWORD not set. Kalshi markets will be skipped.")
            return False
        resp = self.session.post(
            f"{self.base_url}/login",
            json={"email": self.email, "password": self.password},
        )
        if resp.status_code == 200:
            self.token = resp.json().get("token")
            self.session.headers["Authorization"] = f"Bearer {self.token}"
            print("  [kalshi] Logged in successfully")
            return True
        else:
            print(f"  [kalshi] Login failed: {resp.status_code} {resp.text[:200]}")
            return False

    def fetch_markets(self, category: str = None) -> List[dict]:
        """Fetch active markets from Kalshi."""
        if not self.token:
            if not self.login():
                return []
        markets = []
        cursor = None
        while True:
            params = {"limit": 100, "status": "open"}
            if category:
                params["series_ticker"] = category
            if cursor:
                params["cursor"] = cursor
            resp = self.session.get(f"{self.base_url}/markets", params=params)
            if resp.status_code != 200:
                print(f"  [kalshi] Fetch failed: {resp.status_code}")
                break
            data = resp.json()
            markets.extend(data.get("markets", []))
            cursor = data.get("cursor")
            if not cursor:
                break
        return markets

    def get_orderbook(self, ticker: str) -> dict:
        """Fetch orderbook for a specific market."""
        resp = self.session.get(f"{self.base_url}/markets/{ticker}/orderbook")
        resp.raise_for_status()
        return resp.json()

    def parse_market(self, raw: dict) -> Optional[Market]:
        """Convert raw Kalshi response to Market dataclass."""
        try:
            yes_price = raw.get("yes_ask", raw.get("last_price", 0)) / 100
            no_price = 1.0 - yes_price
            volume = int(raw.get("volume", 0))
            spread = abs(
                (raw.get("yes_ask", 50) - raw.get("yes_bid", 50)) / 100
            )

            anomalies = []
            if spread > ANOMALY_SPREAD:
                anomalies.append("wide_spread")

            return Market(
                id=raw.get("ticker", ""),
                title=raw.get("title", "Unknown"),
                platform="kalshi",
                price_yes=yes_price,
                price_no=no_price,
                volume=volume,
                liquidity=float(raw.get("open_interest", 0)),
                end_date=raw.get("expiration_time", ""),
                category=raw.get("series_ticker", ""),
                spread=spread,
                anomalies=anomalies,
                url=f"https://kalshi.com/markets/{raw.get('ticker', '')}",
            )
        except Exception as e:
            print(f"  [skip] Could not parse Kalshi market: {e}")
            return None


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

def scan_markets(category: str = None, output_path: str = None) -> List[Market]:
    """
    Scan both platforms, apply filters, rank by opportunity.
    """
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Scanning markets...")

    # Load failure patterns
    failure_patterns = set()
    failure_log_path = os.path.join(os.path.dirname(__file__), "..", "references", "failure_log.md")
    if os.path.exists(failure_log_path):
        with open(failure_log_path) as f:
            # Extract market names/IDs from failure log (simple heuristic)
            for line in f:
                if line.startswith("### ") and "—" in line:
                    market_name = line.split("—", 1)[1].strip()
                    failure_patterns.add(market_name.lower())

    cutoff = datetime.utcnow() + timedelta(days=MAX_DAYS_TO_EXPIRY)
    all_markets: List[Market] = []

    # --- Polymarket ---
    print("  Fetching Polymarket...")
    try:
        poly = PolymarketClient()
        raw_poly = poly.fetch_markets(category=category)
        print(f"  [polymarket] {len(raw_poly)} raw markets")
        for r in raw_poly:
            m = poly.parse_market(r)
            if m:
                all_markets.append(m)
    except Exception as e:
        print(f"  [polymarket] Error: {e}")

    # --- Kalshi ---
    print("  Fetching Kalshi...")
    try:
        kalshi = KalshiClient()
        raw_kalshi = kalshi.fetch_markets(category=category)
        print(f"  [kalshi] {len(raw_kalshi)} raw markets")
        for r in raw_kalshi:
            m = kalshi.parse_market(r)
            if m:
                all_markets.append(m)
    except Exception as e:
        print(f"  [kalshi] Error: {e}")

    # --- Apply filters ---
    filtered = []
    for m in all_markets:
        # Skip known failures
        if m.title.lower() in failure_patterns:
            continue
        # Volume filter
        if m.volume < MIN_VOLUME:
            continue
        # Expiry filter (best-effort date parsing)
        try:
            end = datetime.fromisoformat(m.end_date.replace("Z", "+00:00")).replace(tzinfo=None)
            if end > cutoff:
                continue
        except (ValueError, AttributeError):
            pass  # If we can't parse the date, keep the market
        filtered.append(m)

    # Sort: markets with anomalies first, then by volume
    filtered.sort(key=lambda x: (-len(x.anomalies), -x.volume))

    print(f"  {len(filtered)} markets passed filters (from {len(all_markets)} total)")

    # --- Output ---
    if output_path:
        with open(output_path, "w") as f:
            json.dump([asdict(m) for m in filtered], f, indent=2)
        print(f"  Saved to {output_path}")
    else:
        for m in filtered[:20]:
            flags = ", ".join(m.anomalies) if m.anomalies else "—"
            print(f"  [{m.platform:11}] {m.price_yes:.2f}¢  vol={m.volume:>6}  {flags:15} {m.title[:60]}")

    return filtered


def watch(category: str = None):
    """Run scanner in a loop."""
    print(f"Starting continuous scan every {SCAN_INTERVAL_MINUTES} min. Ctrl+C to stop.\n")
    while True:
        # Check kill switch
        if os.path.exists("STOP"):
            print("[KILL SWITCH] STOP file detected. Halting.")
            break
        scan_markets(category=category)
        print(f"  Next scan in {SCAN_INTERVAL_MINUTES} min...\n")
        time.sleep(SCAN_INTERVAL_MINUTES * 60)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Prediction Market Connector")
    sub = parser.add_subparsers(dest="command")

    scan_p = sub.add_parser("scan", help="Scan markets once")
    scan_p.add_argument("--category", type=str, default=None, help="Filter by category (e.g., 'weather')")
    scan_p.add_argument("--output", type=str, default=None, help="Save results as JSON")

    watch_p = sub.add_parser("watch", help="Continuous scanning loop")
    watch_p.add_argument("--category", type=str, default=None)

    book_p = sub.add_parser("orderbook", help="Fetch orderbook for a market")
    book_p.add_argument("--market-id", required=True)
    book_p.add_argument("--platform", choices=["polymarket", "kalshi"], required=True)

    args = parser.parse_args()

    if args.command == "scan":
        scan_markets(category=args.category, output_path=args.output)
    elif args.command == "watch":
        watch(category=args.category)
    elif args.command == "orderbook":
        if args.platform == "polymarket":
            client = PolymarketClient()
        else:
            client = KalshiClient()
            client.login()
        book = client.get_orderbook(args.market_id)
        print(json.dumps(book, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
