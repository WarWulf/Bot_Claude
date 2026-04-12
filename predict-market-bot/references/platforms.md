# Platform API Reference

## Polymarket

- **Type:** Crypto-native, built on Polygon
- **Order book:** Central Limit Order Book (CLOB) with off-chain matching, on-chain settlement
- **APIs:** WebSocket for live orderbook updates, REST for market discovery
- **Auth:** EIP-712 signing
- **Docs:** https://docs.polymarket.com
- **Notes:** Has geo-restrictions. Check legal status in your jurisdiction.

## Kalshi

- **Type:** US-regulated exchange (CFTC-regulated)
- **APIs:** REST API with specific header signing
- **Demo:** Has a demo environment with mock funds for testing — use this first
- **Docs:** https://trading-api.readme.io
- **Notes:** Developer Agreement applies. US-regulated.

## Unified Wrapper

- **pmxt:** CCXT-inspired library for prediction markets. Provides a unified interface across Polymarket and Kalshi.
