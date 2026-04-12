// config.js — Configuration sanitization and presets

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeConfigPatch(raw = {}, base = {}) {
  const cfg = { ...raw };
  cfg.scan_interval_minutes = clamp(cfg.scan_interval_minutes ?? base.scan_interval_minutes, 5, 60, 15);
  cfg.scanner_http_retries = clamp(cfg.scanner_http_retries ?? base.scanner_http_retries, 0, 5, 2);
  cfg.scanner_http_timeout_ms = clamp(cfg.scanner_http_timeout_ms ?? base.scanner_http_timeout_ms, 1000, 30000, 8000);
  cfg.scanner_breaker_threshold = clamp(cfg.scanner_breaker_threshold ?? base.scanner_breaker_threshold, 1, 10, 3);
  cfg.scanner_breaker_cooldown_sec = clamp(cfg.scanner_breaker_cooldown_sec ?? base.scanner_breaker_cooldown_sec, 30, 1800, 300);
  cfg.scanner_max_slippage_pct = clamp(cfg.scanner_max_slippage_pct ?? base.scanner_max_slippage_pct, 0, 0.2, 0.02);
  cfg.scanner_min_volume = clamp(cfg.scanner_min_volume ?? base.scanner_min_volume, 0, 1_000_000_000, 200);
  cfg.scanner_min_liquidity = clamp(cfg.scanner_min_liquidity ?? base.scanner_min_liquidity, 0, 1_000_000_000, 200);
  cfg.step1_min_tradeable = clamp(cfg.step1_min_tradeable ?? base.step1_min_tradeable, 1, 100, 5);
  cfg.top_n = clamp(cfg.top_n ?? base.top_n, 1, 200, 10);
  cfg.research_max_headlines = clamp(cfg.research_max_headlines ?? base.research_max_headlines, 10, 300, 80);
  cfg.research_min_keyword_overlap = clamp(cfg.research_min_keyword_overlap ?? base.research_min_keyword_overlap, 1, 8, 2);
  cfg.research_min_credibility = clamp(cfg.research_min_credibility ?? base.research_min_credibility, 0, 1, 0.4);
  cfg.research_source_reddit = cfg.research_source_reddit ?? base.research_source_reddit ?? true;
  cfg.research_source_x = cfg.research_source_x ?? base.research_source_x ?? false;
  cfg.step3_min_edge = clamp(cfg.step3_min_edge ?? base.step3_min_edge, 0.005, 0.2, 0.04);
  cfg.step3_min_confidence = clamp(cfg.step3_min_confidence ?? base.step3_min_confidence, 0.1, 0.99, 0.6);
  cfg.llm_timeout_ms = clamp(cfg.llm_timeout_ms ?? base.llm_timeout_ms, 1500, 60000, 12000);
  cfg.llm_max_tokens = clamp(cfg.llm_max_tokens ?? base.llm_max_tokens, 32, 2000, 220);
  cfg.llm_temperature = clamp(cfg.llm_temperature ?? base.llm_temperature, 0, 1, 0.1);
  cfg.llm_enabled = cfg.llm_enabled ?? base.llm_enabled ?? true;
  cfg.llm_require_provider = cfg.llm_require_provider ?? base.llm_require_provider ?? false;
  cfg.llm_weight_openai = clamp(cfg.llm_weight_openai ?? base.llm_weight_openai, 0, 1, 0.35);
  cfg.llm_weight_claude = clamp(cfg.llm_weight_claude ?? base.llm_weight_claude, 0, 1, 0.25);
  cfg.llm_weight_gemini = clamp(cfg.llm_weight_gemini ?? base.llm_weight_gemini, 0, 1, 0.2);
  cfg.llm_weight_ollama_cloud = clamp(cfg.llm_weight_ollama_cloud ?? base.llm_weight_ollama_cloud, 0, 1, 0.2);
  cfg.log_retention_days = clamp(cfg.log_retention_days ?? base.log_retention_days, 1, 365, 14);
  cfg.log_to_file = cfg.log_to_file ?? base.log_to_file ?? true;
  return cfg;
}

export function buildStep1ProductionPreset() {
  return {
    scanner_source: 'both', scan_interval_minutes: 15, scanner_min_volume: 50000,
    scanner_min_liquidity: 10000, scanner_max_days: 30, scanner_min_anomaly_score: 1.2,
    scanner_max_slippage_pct: 0.02, scanner_http_retries: 2, scanner_http_timeout_ms: 8000,
    scanner_breaker_threshold: 3, scanner_breaker_cooldown_sec: 300,
    scanner_active_from_utc: 0, scanner_active_to_utc: 24, step1_min_tradeable: 5
  };
}
