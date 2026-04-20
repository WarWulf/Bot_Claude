# 🤖 Prediction Market & Forex Trading Bot V4.0

Ein vollständig selbstlernender Trading-Bot mit Web-Dashboard, LLM-Ensemble-Integration, Nachrichten-Intelligence und adaptivem Lernen aus Erfolgen UND Misserfolgen.

> ⚠️ **Paper Trading Modus.** Kein echtes Geld wird bewegt.

---

## Inhalt

1. [Was kann der Bot?](#was-kann-der-bot)
2. [Installation](#installation)
3. [Erste Schritte](#erste-schritte)
4. [Dashboard-Tabs](#dashboard-tabs)
5. [Wie Prediction Markets funktionieren](#wie-prediction-markets-funktionieren)
6. [Wie Forex funktioniert](#wie-forex-funktioniert)
7. [Das selbstlernende System](#das-selbstlernende-system)
8. [News-Intelligence](#news-intelligence)
9. [LLM-Integration](#llm-integration)
10. [Architektur](#architektur)
11. [Einstellungen-Referenz](#einstellungen-referenz)
12. [Token-Verbrauch und Kosten](#token-verbrauch-und-kosten)
13. [Troubleshooting](#troubleshooting)

---

## Was kann der Bot?

Der Bot kombiniert drei getrennte Trading-Systeme in einer Oberfläche. Jedes System hat eigene Logik, eigene Bankroll und eigene Lernmechanismen, aber teilen sich die LLM- und News-Infrastruktur.

### 1. Prediction Markets (Polymarket + Kalshi)
Scannt aktive Wahrscheinlichkeits-Märkte, bewertet sie mit Nachrichtenrecherche, befragt mehrere LLMs gleichzeitig als Superforecaster, und führt Paper Trades mit Kelly Criterion aus.

### 2. Forex Binary Options
Technische Analyse auf Forex-Kerzendaten (TwelveData API). Generiert CALL/PUT Signale und ermöglicht Paper Trading mit 85% Payout-Simulation (wie PocketOption).

### 3. Forex Pro — Stop-Loss/Take-Profit
Realistisches Forex Trading mit SL und TP statt binärer Wetten. ATR-basierte Sizing, 2% Risiko pro Trade, Risk:Reward 1:1.5.

### Selbstlernendes System
Beobachtet Marktausgänge, Quellenqualität, Keywords, Indikator-Kombinationen, KI-Accuracy und News-Prädiktivität. Alle Learnings fließen automatisch in zukünftige Entscheidungen.

---

## Installation

### Voraussetzungen
- VPS (Hetzner, DigitalOcean, AWS) mit mindestens 1GB RAM
- Docker + Docker Compose installiert
- Mindestens ein LLM-API-Key (Gemini ist kostenlos)
- Optional: TwelveData Key (kostenlos, für Forex)

### Schritt-für-Schritt

```bash
# 1. Repository klonen
git clone https://github.com/WarWulf/Bot_Claude.git
cd Bot_Claude

# 2. Docker-Container bauen und starten
docker compose build
docker compose up -d

# 3. Logs prüfen (optional)
docker compose logs -f backend

# 4. Dashboard öffnen
# http://DEINE-VPS-IP:5173
```

### Updates installieren

```bash
docker compose down
docker compose build
docker compose up -d
```

Daten bleiben bei Updates erhalten (Docker Volume `data/state.json`).

---

## Erste Schritte

### Schritt 1: LLM aktivieren (pflicht)

1. Dashboard → **⚙️ Einstellungen** → Abschnitt **KI & Predict**
2. Aktiviere mindestens einen Provider:
   - **Gemini** (kostenlos, empfohlen): Key von [aistudio.google.com](https://aistudio.google.com)
   - **Ollama Cloud** (günstig): Key von [ollama.com](https://ollama.com)
   - **OpenAI, Claude, Kimi**: kostenpflichtig, hohe Qualität
3. Empfohlene Einstellungen:
   - LLM Timeout: **25000ms**
   - LLM Max Tokens: **500**
   - Delay zwischen Märkten: **4000ms** (wichtig für Gemini Free Tier wegen Rate Limit)
   - LLM Retries: **2**
4. Speichern klicken

### Schritt 2: Prediction Markets testen

1. Tab **🚀 Pipeline** öffnen
2. Button **🔬 Scan Diagnose** klicken — prüft ob Polymarket und Kalshi erreichbar sind
3. Wenn alles grün ist: Button **Full Pipeline** klicken
4. Bot durchläuft jetzt alle 5 Schritte (Scan → Research → Predict → Execute → Risk)
5. Ergebnisse erscheinen in Tab **📊 Ergebnisse**

### Schritt 3: Forex aktivieren (optional)

1. TwelveData Key holen: [twelvedata.com/pricing](https://twelvedata.com/pricing) → Free Plan (800 Requests/Tag kostenlos)
2. Dashboard → **⚙️ Einstellungen** → Forex
3. API Key eintragen → Speichern
4. Tab **📈 Binary** → Button **🔬 API testen** — sollte "✅ twelvedata API funktioniert" anzeigen
5. Für realistisches Trading: Tab **💹 Forex Pro** verwenden (empfohlen über Binary)

### Schritt 4: Auto-Trading aktivieren (optional, nach Tests)

1. Erst 20-30 Trades manuell im Paper-Modus machen
2. Im Learning Tab prüfen: ist die Win Rate ≥55%?
3. Wenn ja: Einstellungen → Forex → Auto-Trading **AN**
4. Interval: **5min**, Min Score: **0.5**
5. Bot scannt jetzt alle 5 Minuten und tradet automatisch bei starken Signalen

---

## Dashboard-Tabs

### 🚀 Pipeline
Der zentrale Kontroll-Tab für Prediction Markets. Zeigt:
- **Bot-Status** mit Runtime, aktueller Schritt, Fehler
- **Bankroll & P&L** aktuelle Performance
- **Step Status** welcher der 5 Pipeline-Schritte zuletzt lief
- **Buttons** Full Pipeline, nur Scan, nur Research, nur Predict, Scan Diagnose, LLM Test
- **Live Log** die letzten 50 Ereignisse

### 🏪 Märkte
Alle gescannten Märkte mit:
- Kategorie-Badges (finance, crypto, politics, sports, etc.)
- Volume und Liquidität
- Aktueller Preis (Marktwahrscheinlichkeit)
- Tage bis Ablauf
- Plattform-Badge (Polymarket vs Kalshi)
- Opportunity Score

### 📊 Ergebnisse
Trade-Performance und LLM-Predictions:
- **Bankroll-Chart** historischer Verlauf
- **Daily P&L Chart** täglicher Gewinn/Verlust
- **Aktive Trades** mit Edge, Dauer, Plattform
- **Abgeschlossene Trades** mit P&L
- **Predictions** mit LLM-Rationale (warum hat der Bot diese Richtung empfohlen?)

### 🛡️ Risk
Risiko-Kontrolle:
- **Drawdown Gauge** (aktueller Verlust vom Höchststand)
- **Exposure Gauge** (% Bankroll in offenen Trades)
- **Daily Loss Gauge** (heutiger Verlust)
- **Position Limits** (max Größe pro Trade)
- **Risk Level** OK / ELEVATED / HIGH

### 📈 Binary (Forex Binary Options)
- **🔬 API testen** prüft TwelveData-Verbindung
- **Erklärung** was CALL und PUT bedeuten
- **Bankroll** separate Forex-Bankroll (default $100)
- **Auto-Mode Toggle** 🟢/⚪
- **Smart Recommendations** mit Score, empfohlener Einsatz, Dauer
- **🤖 KI fragen** Button bei jedem Signal (nutzt News + Learning)
- **📰 Forex News Card** — Sentiment pro Währung
- **Laufende Trades** mit Countdown-Timer
- **Trade-Historie**
- **🧠 Forex Learning** Karte mit Kombinationen, Streaks, KI-Accuracy

### 💹 Forex Pro (SL/TP Trading)
- **Erklärung** Stop-Loss und Take-Profit
- **Bankroll** separate Pro-Bankroll (default $1000)
- **Bankroll-Stats** Win Rate, Profit Factor, Avg R:R
- **Offene Trades** mit Live-Pip-Tracking (aktualisiert alle 5 Sek)
- **✂️ Jetzt schließen** pro Trade (manueller Close)
- **🎯 Empfehlungen** mit ATR-basiertem SL/TP, Risk:Reward, Break-even WR
- **Ein-Klick-Trading** mit vorausberechneten Werten

### 🧠 Learning
Das selbstlernende Gedächtnis:
- **PM Prediction Accuracy** — wie korrekt sind die Vorhersagen insgesamt?
- **Forex Signal Accuracy** — wie oft liegen Signale richtig (auch ohne Trade)?
- **Quellen-Ranking** A/B/C/D für jede Nachrichtenquelle
- **News-Einfluss auf Trades** (NEU) — sind News wirklich prädiktiv?
- **💾 Gedächtnis-Übersicht** zeigt wie viele Daten gespeichert sind
- **🔍 Automatische Entdeckungen** — Gewinner-/Verlierer-Keywords, Subreddit-Vorschläge

### ⚙️ Einstellungen
Alle ~80 Einstellungen in Kategorien:
- Bot & Bankroll
- Scanner (Volume, Liquidität, Preis-Filter)
- Research (RSS, Reddit, NewsAPI, GDELT)
- KI & Predict (LLM Provider, Weights, Timeouts)
- Risk (Drawdown, Exposure, Position-Limits)
- Forex (API, Pairs, Interval, Auto-Trading)
- Forex Pro (Bankroll, Risiko %, SL/TP)
- System (Logging, Password)

Jede Einstellung hat:
- **Beschreibung** was sie tut
- **Empfehlung** mit Begründung
- **Grün/Gelb-Badge** zeigt ob aktuell der empfohlene Wert gesetzt ist

### 📋 Log
Diagnose und Transparenz:
- **Brier Score** Vorhersage-Kalibrierung
- **🤖 LLM Prompt Log** (NEU) — komplette Prompts die an jeden LLM gesendet wurden
- **📰 News Digest** Headlines die der Bot als relevant erkannt hat
- **Compound Status** Performance-Analyse
- **Nightly Reviews** tägliche Zusammenfassungen
- **Live Log** alle Ereignisse

---

## Wie Prediction Markets funktionieren

### Die 5-Step Pipeline

```
SCAN → RESEARCH → PREDICT → EXECUTE → RISK
```

### Schritt 1: SCAN (scanner.js)
Holt aktive Märkte von Polymarket und Kalshi APIs. Filter:
- Min Volume (default 200 Kontrakte)
- Min Liquidität
- Preis zwischen 5-95%
- Nicht abgelaufen (mindestens 1 Tag bis Ende)
- Optional: nur bestimmte Kategorien

Jeder Markt bekommt einen **Opportunity Score** basierend auf Spread, Volume und Preis-Position.

### Schritt 2: RESEARCH (research.js)
Für die Top N Märkte (default 10):
- Holt Headlines von **10 RSS-Feeds** parallel
- Durchsucht **8 Reddit Subreddits**
- Optional: NewsAPI und GDELT
- **Tokenisiert** Headlines und Markt-Fragen
- **Matched** Headlines zu Märkten via Keyword-Overlap
- Berechnet **Sentiment** (bullish/bearish/neutral) aus 90+ Wörtern
- Gewichtet Quellen nach gelernten Credibility-Scores
- Erstellt einen **Research Brief** pro Markt mit Thesis, Catalysts, Risks

### Schritt 3: PREDICT (predict.js)
Für jeden Research Brief:
- Baut einen **Superforecaster-Prompt** mit:
  - Markt-Frage + aktueller Preis
  - Recherche-Headlines + Sentiment
  - **Vollständiger Trade-Historie** (Win Rate, Brier Score, Kategorie-WR, letzte Verluste)
- Fragt **ALLE aktivierten LLMs parallel** (Ensemble)
- Jeder LLM gibt: `{probability_yes, confidence, rationale}`
- Bot gewichtet die Antworten nach konfigurierten Weights
- Berechnet finalen **Edge**: `model_prob - market_prob`
- Wenn Edge > 3% und Confidence > 55% → **actionable**

### Schritt 4: EXECUTE (execution.js)
Für jede actionable Prediction:
- Prüft: nicht schon getradet? Nicht abgelaufen?
- Berechnet Position Size mit **Quarter-Kelly Criterion**
- Erstellt Paper Trade (oder echten Order wenn aktiviert)
- Speichert mit Entry-Preis, Edge, Kategorie, Plattform

### Schritt 5: RISK (riskEngine.js)
Nach jedem Trade:
- **Drawdown-Check** (max 8%)
- **Tagesverlust-Check** (max 3%)
- **Exposure-Check** (max 50% der Bankroll)
- **Position Count Limit**
- Bei Überschreitung: Circuit Breaker → keine neuen Trades

### Compound-Schritt (nach allen Trades)
- Berechnet Win Rate, Profit Factor, Sharpe Ratio
- Aktualisiert **Brier Score** für Kalibrierung
- Klassifiziert Fehlentscheidungen: low_edge, low_confidence, oversized, bad_prediction
- Schreibt Erkenntnisse in `failure_log.md`
- Läuft **Learning-Zyklus** für Quellenbewertung

### Nightly Review
Einmal pro Tag:
- Zählt heutige Trades, PnL, Win Rate
- Prüft Outcomes von gestrigen Predictions
- Aktualisiert Brier Samples
- Speichert als `nightly_reviews` für langfristige Analyse

---

## Wie Forex funktioniert

### Technische Analyse (generateSignal)
6 Indikatoren werden auf Kerzendaten (1min, 5min, 15min, 1h) berechnet:

**1. RSI(14)** — Relative Strength Index
- <30: überverkauft (bullish)
- \>70: überkauft (bearish)

**2. MACD(12,26,9)** — Moving Average Convergence Divergence
- Histogramm positiv: bullish
- Signalline-Crossover: Trendwechsel

**3. Bollinger Bands(20, 2σ)**
- Preis am unteren Band: oversold
- Preis am oberen Band: overbought

**4. Stochastic Oscillator(14)**
- %K <20: oversold
- %K >80: overbought

**5. SMA Trend (20/50)**
- Preis > SMA20 > SMA50: Aufwärtstrend
- Preis < SMA20 < SMA50: Abwärtstrend

**6. Candlestick Patterns**
- Hammer, Shooting Star, Engulfing, Doji

### Signal-Aggregation
- Jeder Indikator gibt Score von -1.0 (stark bearish) bis +1.0 (stark bullish)
- Durchschnitt aller Scores = avg_score
- Agreement = % der Indikatoren die in gleiche Richtung zeigen
- **STRONG Signal:** avg_score > 0.5 UND agreement > 70%
- **MEDIUM:** avg_score > 0.3
- **WEAK:** avg_score > 0.15
- **WAIT:** darunter

### Forex Binary Options (📈 Binary Tab)
- CALL = Wette auf Preissteigerung in X Minuten
- PUT = Wette auf Preisfall
- Auszahlung: bei Gewinn 85% vom Einsatz, bei Verlust 100% Verlust
- **Break-even Win Rate: 54%**
- Trade-Dauer: 1, 2, 3, 5, 10, 15 Minuten
- Nach Ablauf automatische Resolution

### Forex Pro — SL/TP (💹 Pro Tab)
Realistisches Trading:
- **Stop-Loss** = maximaler Verlust in Pips (default 20)
- **Take-Profit** = Gewinnziel in Pips (default 30)
- **Risk:Reward** = 1:1.5 → nur 40% Win Rate nötig
- **Position Size** = 2% der Bankroll Risiko pro Trade
- **ATR-basiertes Sizing:** SL = 1.5× ATR, TP = 2.5× ATR
- Trade bleibt offen bis SL oder TP erreicht wird
- Manuelles Schließen jederzeit möglich

### Smart Recommendations
Der Bot berechnet für jedes Signal einen **finalen Score** (0-1):

```
Start: technische Confidence (0-1)
+ 0.15 wenn Paar historisch WR ≥58%
- 0.2 wenn Paar historisch WR <48%
+ 0.1 wenn Richtung historisch WR ≥58%
+ 0.05 pro zuverlässigem Indikator (Accuracy ≥60%)
+ 0.1 wenn aktuelle Stunde historisch WR ≥60%
+ 0.12 wenn News die Richtung unterstützen
- 0.1 wenn News widersprechen
= Finaler Score

Score ≥ 0.5 → TRADE (grün)
Score ≥ 0.3 → MAYBE (gelb)
Score < 0.3 → SKIP (grau)
```

### Auto-Trading
Wenn aktiviert:
- Bot scannt alle X Minuten (default 5)
- Findet er ein Signal mit Score ≥ Threshold (default 0.5)
- Öffnet automatisch Trade mit empfohlenen Werten
- Respektiert Max Concurrent Trades Limit

### 📝 Manuelles Trading (NEU)
Für Benutzer die den Bot als Trading-Assistent verwenden wollen (nicht Paper-Modus):

**Workflow:**
1. Im Binary Tab Signale scannen
2. Bei einem guten Signal: Button **📝 Plan** klicken
3. Bot berechnet basierend auf Bankroll + Learning:
   - **Empfohlener Einsatz** (Kelly-Formel)
   - **Empfohlene Dauer** (aus Learning-Daten)
   - **Zeitfenster** (jetzt bis jetzt+2 Min)
   - **Klare Anweisung:** "Eröffne CALL auf EUR/USD mit $5 Einsatz und 3 Min Dauer, möglichst bis 14:32"
4. Du öffnest den Trade manuell auf deiner Broker-Plattform (PocketOption, Quotex, IQ Option, etc.)
5. Nach Ablauf des Trades: **📋 Ergebnis eintragen** klicken
6. Eingeben: WIN / LOSS / DRAW, optional tatsächlicher Einsatz, tatsächliche Dauer, Entry-/Exit-Preise
7. Bot:
   - Updated deine Forex-Bankroll
   - Speichert als MANUAL-Trade in die History
   - Lernt daraus (Indikatoren, Patterns, Stunde, Pair — alles wird getrackt)

**Vorteil:** Bot lernt aus echten Trades auf deiner Broker-Plattform, nicht nur Paper-Simulation. News-Impact, Indikator-Accuracy, Pair-Performance — alles fließt ein.

**Plan-Status:**
- 🟡 **PENDING** — Plan erstellt, warte auf Ergebnis-Meldung
- ✅ **RESULT_REPORTED** — Trade abgeschlossen, gelernt
- ❌ **CANCELLED** — Manuell abgebrochen

Pläne haben ein Gültigkeits-Fenster von 2 Minuten. Nach Ablauf zeigt das UI ⚠ ABGELAUFEN — du kannst trotzdem ein Ergebnis melden, aber das Zeitfenster war möglicherweise zu spät für einen sinnvollen Trade.

---

## Das selbstlernende System

Der Bot hat **8 Feedback-Loops** die parallel laufen:

### Loop 1: Trade-Historie → LLM Prompt
Jeder Predict-Prompt enthält automatisch:
- Gesamt-Win-Rate und Brier Score
- Performance pro Kategorie ("politics nur 38% WR")
- Letzte 3 Verluste als Beispiele
- Ähnliche Märkte aus der Vergangenheit

### Loop 2: PM Market Observer (ohne Trade)
Alle 2 Minuten prüft der Bot:
- Welche Märkte sind ausgelaufen?
- Was war das tatsächliche Ergebnis?
- War die Vorhersage richtig — auch wenn nicht getradet?
- **Verpasste Gewinner** werden als "missed_winners" geloggt

### Loop 3: Forex Signal Observer (ohne Trade)
- Jedes Forex-Signal wird geloggt mit Einstiegspreis
- Nach 5 Minuten: aktuellen Preis holen, prüfen ob Signal richtig war
- Ergebnis fließt in "Forex Signal Accuracy"

### Loop 4: Source Credibility Scoring
Für jede Prediction-Outcome:
- Welche Quellen trugen zur Research bei?
- Wenn Prediction richtig: +1 correct für diese Quellen
- Wenn falsch: +1 wrong
- Nach 3+ Outcomes: **Credibility Score** (0-1)
- **Grade:** A (≥65%), B (≥50%), C (≥35%), D (<35%)
- Scores fließen **zurück in Research** — Grade A Quellen bekommen mehr Gewicht

### Loop 5: Keyword Discovery
Bot analysiert Gewinner vs Verlierer Trades:
- **Gewinner-Keywords:** erscheinen häufiger in profitablen Trades
- **Verlierer-Keywords:** erscheinen häufiger in Verlusten
- Schlägt automatisch neue **Subreddits** vor basierend auf gehandelten Kategorien

### Loop 6: LLM Opinion Tracking
Jede "🤖 KI fragen" Anfrage wird geloggt:
- Was hat die KI gesagt? (take_trade, confidence)
- Welcher Preis zum Zeitpunkt?
- Nach 5 Min: lag die KI richtig?
- Nach 5+ Meinungen: **LLM Accuracy** wird dem nächsten Prompt mitgeteilt

### Loop 7: Indicator Combination Learning
Nicht nur einzelne Indikatoren, sondern welche **zusammen** funktionieren:
- `rsi+bollinger: 71% WR` ← BESTE KOMBO
- `macd+stochastic: 38% WR` ← SCHLECHTESTE KOMBO
- LLM bekommt diese Info und kann sagen: "Aktiv sind rsi+bollinger → Kombi hat 71%, nimm Trade"

### Loop 8: News Impact Tracking (NEU)
Bei jedem geschlossenen Forex-Trade:
- Was hat das News-Sentiment gesagt?
- Hat der Trade gewonnen oder verloren?
- Stimmten die News mit dem Outcome überein?
- Nach 5+ Trades: **News Predictive Power** wird dem nächsten LLM-Prompt mitgeteilt

```
NEWS PREDICTIVE POWER: 68% (17/25) — news IS useful
```
oder
```
NEWS PREDICTIVE POWER: 38% (8/21) — news MISLEADING — weight less
```

### Selbst-Optimierung
Der Bot generiert konkrete Handlungsempfehlungen:
```
⚠ Win Rate 47% — nur STRONG Signale traden
🔧 WEAK Signale <45% WR — ignorieren
🔧 GBP/USD nur 43% WR — aus Watchlist entfernen
✅ STRONG Signale >60% WR — Einsatz erhöhen
✅ Beste Kombi: rsi+bollinger (71%) — bevorzugen
⚠ 3 Verluste in Folge — Pause oder Einsatz reduzieren
```

---

## News-Intelligence

### Quellen (6 Forex-spezifische Feeds)
- **ForexLive.com** — Minuten-aktuell, Forex-Fokus
- **FXStreet.com** — Forex-Analyse
- **DailyFX.com** — Forex + Markttechnik
- **Reuters Business** — Allgemein hochqualitativ
- **BBC Business** — Allgemein
- **CNBC** — Märkte USA

### Plus 10 RSS-Feeds für Prediction Markets
Reuters Top News, Reuters Business, BBC World, BBC Business, NYT Business, CNBC (2×), MarketWatch, Financial Times, CNBC World.

### Plus 8 Reddit Subreddits
worldnews, politics, economics, CryptoCurrency, wallstreetbets, PredictionMarkets, geopolitics, technology.

### Currency Matching
Der Bot matched Headlines zu Währungen über 70+ Keywords:

| Währung | Keywords |
|---------|----------|
| USD | fed, fomc, powell, nonfarm, cpi, us gdp, treasury, dollar |
| EUR | ecb, lagarde, eurozone, eu inflation, eu gdp |
| GBP | boe, bailey, uk inflation, sterling, uk gdp |
| JPY | boj, ueda, yen, japan inflation, nikkei |
| AUD | rba, australian economy, iron ore, china trade |
| CHF, CAD, NZD | jeweils eigene Keywords |

### High-Impact Detection
18 Keywords für marktbewegende Events:
- rate decision, rate cut, rate hike
- nfp, nonfarm payroll, jobs report
- cpi, inflation data
- gdp, economic growth
- central bank, monetary policy
- geopolitical, war, conflict, sanction

### Adaptive Article Body Fetching (Smart Option B + C)
Der Bot entscheidet **automatisch** ob Artikel-Volltext geholt wird:

| Trigger | Aktion |
|---------|--------|
| User klickt "🤖 KI fragen" | ✅ Volltext holen (Top 5 Artikel) |
| HIGH IMPACT Event erkannt | ✅ Volltext holen |
| Weniger als 3 relevante Headlines | ✅ Volltext holen (brauchen mehr Kontext) |
| Letzter Volltext-Fetch <5 Min her | ❌ Skip (spart Zeit) |
| Normaler Scan, keine HIGH IMPACT | ❌ Nur Headlines + RSS Descriptions |

Option C (RSS Descriptions) ist **immer aktiv** — keine extra HTTP-Requests, da schon im RSS-Feed enthalten.

### Sentiment Pro Währung
```
USD: BEARISH (3↑ 7↓ 2→ from 12 headlines)
EUR: BULLISH (4↑ 1↓ 2→ from 7 headlines)
```

Für ein Paar EUR/USD leitet der Bot ab:
- EUR bullish + USD bearish → **News favorisieren CALL**

---

## LLM-Integration

### Verfügbare Provider
Der Bot unterstützt **6 LLM-Provider**, alle gleichzeitig nutzbar:

| Provider | Qualität | Preis | Empfehlung |
|----------|----------|-------|------------|
| **Gemini 2.0 Flash** | Hoch | **Kostenlos** (Free Tier) | ✅ Start hier |
| **Ollama Cloud** | Gut | ~$0.50 / 1M Tokens | ✅ Günstige Alternative |
| **OpenAI GPT-4o-mini** | Sehr hoch | ~$0.15 / 1M Input, $0.60 Output | Bei höherem Budget |
| **Claude Sonnet** | Sehr hoch | ~$3 / 1M Input | Beste Qualität, teuer |
| **Local Ollama** | Variable | Kostenlos (lokal) | Wenn eigener GPU-Server |
| **Kimi Direct** | Gut | Günstig | Asiatische Alternative |

### Ensemble-Modus
Der Bot nutzt **ALLE aktivierten LLMs parallel** — nicht nur einen:

**Für PM Predict:**
```
Alle 4 LLMs bekommen den gleichen Prompt
  ↓
Jeder LLM gibt: {probability_yes, confidence, rationale}
  ↓
Bot gewichtet die Antworten:
  - OpenAI: 35%
  - Claude: 25%
  - Gemini: 20%
  - Ollama: 20%
  ↓
Finale Probability = gewichteter Durchschnitt
```

**Für Forex LLM Opinion (seit Update):**
```
Alle aktiven LLMs werden PARALLEL befragt
  ↓
Jeder gibt: {take_trade, confidence, reason, risk_level}
  ↓
Ensemble-Voting: >50% der gewichteten Stimmen = TRADE
Agreement % wird angezeigt (1/4 = 25%, 4/4 = 100%)
```

### LLM Prompt Logging (NEU)
Jeder an einen LLM gesendete Prompt wird jetzt geloggt:
- Wann? Welcher Provider? Welches Model?
- Prompt-Länge in Zeichen und geschätzten Tokens
- **Kompletter Prompt** (bei >3000 Zeichen: erste 1500 + letzte 1500)
- Response-Preview
- Duration in Millisekunden
- Success/Failure

Ansicht: **📋 Log** Tab → **🤖 LLM Prompt Log** → "Prompts laden" → auf Eintrag klicken für Details.

Letzte 100 Prompts bleiben im Gedächtnis.

### Was steht im Predict-Prompt?
Der LLM-Prompt für PM Predict ist strukturiert in 4 Sektionen:

1. **MARKET**: Frage, Kategorie, aktueller YES-Preis, Tage bis Ablauf, Volume, Spread
2. **EVIDENCE**: Headlines mit Quellen, Sentiment-Breakdown, Thesis, Risks
3. **HISTORICAL PERFORMANCE** (gelernte Daten):
   - Gesamt-Win-Rate mit Bewertung ("performing well" / "POOR")
   - Brier Score mit Interpretation
   - Kategorie-WR ("politics only 38% WR → be cautious")
   - Letzte 3 Verluste als Beispiele
4. **ANALYSIS FRAMEWORK**: 7-Step Superforecaster-Methodik

### Was steht im Forex-LLM-Prompt?
Struktur:
1. **SIGNAL** — Paar, Preis, Richtung, Confidence, Strength, Agreement, UTC-Zeit
2. **INDICATORS** — alle 6 Scores mit Begründung, Patterns, Bollinger, ATR
3. **HISTORICAL PERFORMANCE** — Pair WR, Indikator-Accuracy, Combos, Streaks
4. **NEWS INTELLIGENCE** — Sentiment pro Währung, High Impact Events, Article Excerpts
5. **RULES** — selbst-optimierte Handlungsempfehlungen
6. **ANALYSIS** — 6 Fragen die der LLM beantwortet

Beispiel-Fragment:
```
PAIR PERFORMANCE:
  EUR/USD: 62% WR (16T, +$18) ← STRONG PAIR
  GBP/USD: 43% WR (10T, -$8) ← AVOID

INDICATOR RELIABILITY:
  RSI: 68% accurate ← RELIABLE
  MACD: 42% accurate ← UNRELIABLE, IGNORE

INDICATOR COMBOS:
  rsi+bollinger: 71% WR ← BEST COMBO

⚡ HIGH IMPACT: Fed signals September rate cut [bearish]
   Context: Federal Reserve Chair Powell said...

RULES (follow these):
  ✅ STRONG Signale >60% WR. Einsatz erhöhen.
  🔧 GBP/USD nur 43% WR. Aus Watchlist entfernen.

NEWS PREDICTIVE POWER: 68% (17/25) — news IS useful
```

---

## Architektur

```
┌─────────────────────────────────────────────────┐
│  Frontend (React + Vite) — ~1500 Zeilen         │
│  9 Tabs, ~70 Einstellungen                      │
└──────────────────┬──────────────────────────────┘
                   │ HTTP JSON API
┌──────────────────▼──────────────────────────────┐
│  Backend (Node.js Express) — ~6500 Zeilen       │
├──────────┬──────────────┬──────────┬────────────┤
│ PM 5-Step│ Forex System │ Learning │ News Intel │
│ Pipeline │ Binary + Pro │ Engine   │ System     │
├──────────┼──────────────┼──────────┼────────────┤
│scanner.js│forexSignals  │learning  │research.js │
│research  │.js (~1500)   │Engine.js │+forexNews  │
│predict.js│              │(~500)    │            │
│execution │              │          │            │
│riskEngine│              │          │            │
└──────────┴──────────────┴──────────┴────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  State Persistence                               │
│  data/state.json (Docker Volume)                 │
│  Auto-Cleanup: 19 Arrays kapped                  │
└──────────────────────────────────────────────────┘
```

### Backend-Module (23 Dateien)

| Datei | Zeilen | Funktion |
|-------|--------|----------|
| `index.js` | ~980 | Express Routes, Timers, Pipeline Orchestration |
| `forexSignals.js` | ~1500 | Technische Analyse, Binary+Pro, News, LLM Opinion |
| `learningEngine.js` | ~500 | 8 Self-Learning Loops, News Impact |
| `predict.js` | ~340 | LLM Ensemble, Prompt Logging, Retry Logic |
| `scanner.js` | ~325 | PM Scan, Filter, Ranking, DB Cleanup |
| `appState.js` | ~330 | State Defaults, Cleanup, Persistent Logs |
| `platforms.js` | ~215 | Polymarket + Kalshi API Clients |
| `research.js` | ~180 | PM Research, Multi-Source, Source Scoring |
| `utils.js` | ~120 | HTTP Retry, Sentiment (90+ Wörter), Tokenize |
| `riskEngine.js` | ~85 | Drawdown, Daily Loss, Exposure |
| `execution.js` | ~90 | Kelly Criterion, Trade Execution |
| `tradeEngine.js` | ~80 | Position Sizing |
| `correlatedMarkets.js` | ~50 | Mutually Exclusive Market Detection |
| `pipeline.js` | ~150 | 5-Step Orchestration |
| `auth.js`, `config.js` | ~110 | Authentication, Config |
| `websockets.js` | ~65 | WebSocket Live Updates |
| `scanCore.js`, `stepRegistry.js` | ~60 | Helpers |

### Daten-Persistenz
Alles in `data/state.json` (Docker Volume):
- `config`, `providers` — Einstellungen
- `markets`, `scan_results`, `scan_runs` — PM Scans
- `research_briefs`, `research_runs`, `news_digest` — PM Research
- `predictions`, `predict_runs` — LLM Predictions
- `trades`, `orders`, `execution_runs` — PM Trades
- `forex_trades`, `forex_pro_trades` — Forex Trades
- `forex_signals`, `forex_signal_log` — Forex Signale
- `forex_llm_log` — KI-Meinungen Forex
- `forex_news`, `forex_news_history` — News Intelligence
- `forex_news_trade_log` — News Impact Learning
- `source_scores`, `source_ranking` — Quellen-Credibility
- `prediction_outcomes` — PM Outcomes
- `llm_prompt_log` — alle LLM Prompts
- `keyword_discoveries` — Auto-Entdeckungen
- `compound_summary`, `brier_score`, `nightly_reviews` — Performance

### Auto-Cleanup bei jedem Save
19 Arrays werden bei jedem `saveState()` auf sichere Maximalwerte gekürzt:
- Logs: 300
- Scan/Research/Predict/Execute/Risk Runs: 50 jeweils
- Predictions: 200
- Trades: 500
- Forex Trades: 500 pro Typ
- Forex Signal Log: 300
- LLM Prompt Log: 100
- News History: 200
- scan_history: 100 Märkte × 20 Datenpunkte

---

## Einstellungen-Referenz

### Bot & Bankroll
| Setting | Default | Empfohlen |
|---------|---------|-----------|
| Bankroll | $1000 | $100-500 zum Start |
| Paper Mode | true | true (bis 100+ Trades verifiziert) |
| Top N Markets | 10 | 5-10 |
| Scan Interval | 15 min | 15 min |
| Kelly Fraction | 0.25 | 0.25 (Quarter-Kelly) |
| Max Position % | 0.05 | 0.05 (5% pro Trade) |

### Scanner
| Setting | Default | Empfohlen |
|---------|---------|-----------|
| Min Edge | 0.04 | 0.03-0.04 |
| Min Volume | 200 | 200 |
| Min Liquidity | 0 | 0 |
| Min Market Price | 0.05 | 0.05 |
| Max Market Price | 0.95 | 0.95 |
| Scanner Source | both | both (Polymarket + Kalshi) |

### KI & Predict
| Setting | Default | Empfohlen |
|---------|---------|-----------|
| LLM Enabled | true | true |
| LLM Timeout | 25000ms | 25000ms |
| LLM Max Tokens | 500 | 500 |
| LLM Temperature | 0.1 | 0.1 (deterministisch) |
| LLM Retries | 2 | 2 |
| Delay between Markets | 4000ms | 4000ms (für Gemini Free Tier) |
| LLM Log Prompts | true | true |
| Weight OpenAI | 0.35 | 0.35 |
| Weight Claude | 0.25 | 0.25 |
| Weight Gemini | 0.20 | 0.20 |

### Risk
| Setting | Default | Empfohlen |
|---------|---------|-----------|
| Max Drawdown | 0.08 | 0.08 (8%) |
| Max Daily Loss | 0.03 | 0.03 (3%) |
| Max Exposure | 0.50 | 0.50 (50% der Bankroll) |
| Max Positions | 10 | 10 |

### Forex
| Setting | Default | Empfohlen |
|---------|---------|-----------|
| Forex API Key | - | twelvedata.com |
| Forex Pairs | EUR/USD,GBP/USD,USD/JPY,AUD/USD | Majors |
| Forex Interval | 5min | 15min (bessere Qualität) |
| Forex Bankroll | $100 | $100 |
| Forex Payout % | 85 | 85 |
| Forex Max Concurrent | 2 | 2 |

### Forex Pro
| Setting | Default | Empfohlen |
|---------|---------|-----------|
| Pro Bankroll | $1000 | $1000 |
| Risk % | 0.02 | 0.02 (2% pro Trade) |
| Default SL (Pips) | 20 | 20 |
| Default TP (Pips) | 30 | 30 |
| Max Concurrent | 3 | 3 |

---

## Token-Verbrauch und Kosten

### PM Predict (pro Markt)
- Input: ~1500 Tokens (Prompt 800 + Learning 600 + Headlines 100)
- Output: ~150 Tokens
- **Pro Markt pro LLM: ~1650 Tokens**

Bei 4 aktiven LLMs × 10 Märkten × 4 Pipelines/Tag = **264k Tokens/Tag**

### Forex LLM Opinion (pro Klick)
- Ohne Article Bodies: ~1200 Input + 150 Output = ~1350 Tokens/LLM
- Mit Article Bodies (HIGH IMPACT): ~2500 Input + 200 Output = ~2700 Tokens/LLM

Bei 4 aktiven LLMs × 10 Anfragen/Tag = **~108k Tokens/Tag**

### Kosten-Schätzung (pro Monat)

**Nur Gemini Free Tier:**
- PM + Forex: **$0.00** (im Rahmen der Free Tier)

**Gemini Free + Ollama Cloud:**
- ~12M Tokens/Monat × $0.50/1M = **~$6/Monat**

**Bei OpenAI + Claude:**
- ~12M Tokens/Monat × gewichteter Durchschnitt = **~$30-50/Monat**

### Empfehlung
Start mit nur **Gemini Free Tier** → dann Ollama Cloud dazu wenn Qualität steigen soll → OpenAI/Claude nur wenn du dir das Budget leisten kannst.

---

## Troubleshooting

### "Kein API-Key!" beim Forex-Scan
- Einstellungen → Forex → API Key eintragen
- TwelveData: [twelvedata.com](https://twelvedata.com) → kostenlos registrieren

### Polymarket liefert keine Märkte
- Tab Pipeline → "🔬 Scan Diagnose" klicken
- Prüfe Filter: Min Volume zu hoch? Kategorien zu restriktiv?
- Wochenende: weniger aktive Märkte

### LLM Timeout
- Einstellungen → LLM Timeout auf 35000ms erhöhen
- LLM Retries auf 3 erhöhen
- Gemini Rate Limit: Delay auf 6000ms erhöhen

### Forex-Tab zeigt NaN%
- TwelveData API Key fehlt oder ungültig
- Markt geschlossen (Wochenende)
- "🔬 API testen" klicken für Diagnose

### Bot lernt nicht
- Mindestens 3-5 abgeschlossene Trades nötig
- Learning Tab → "Learning Zyklus jetzt" klicken für manuellen Run
- Tab Learning → "💾 Gedächtnis-Übersicht" prüfen ob Daten gesammelt werden

### state.json wird riesig
- Auto-Cleanup kürzt automatisch bei jedem Save
- Komplett-Reset möglich: Einstellungen → Komplett-Reset (Config bleibt)

---

## Bekannte Schwächen — TODO Liste

Ehrliche Auflistung von identifizierten Schwächen. Sortiert nach Kritikalität. Behobene Punkte mit ✅ markiert.

### 🔴 KRITISCH — Profitabilität

**1. Spread/Slippage-Simulation ~~~~ ✅ BEHOBEN (19.04)**
- ~~Echte Forex-Broker nehmen 1-3 Pips pro Trade als Spread — nicht simuliert~~
- **Behoben:** Config-Optionen `forex_spread_pips` (1.5), `forex_slippage_pips` (0.5), `forex_simulate_spread` (true). Binary zieht Spread beim Exit ab, Pro beim Entry. Paper-Ergebnisse jetzt realistisch.

**2. Statistisch nicht signifikante Learning-Schwellen ~~~~ ✅ BEHOBEN (20.04)**
- ~~Bot lernte ab 3-5 Trades — Stichprobenfehler ±22%~~
- **Behoben:** Wilson Score Confidence Intervals für jede Statistik, Signifikanz-Klassen (sehr gering/gering/moderat/gut/hoch), Thresholds erhöht auf 10+ Trades für Suggestions, UI zeigt 95%-CI in jedem Insight. Insights zeigen "statistisch signifikant" oder "mehr Daten sammeln".

### 🟡 WICHTIG — Qualität

**3. Race Condition bei saveState ~~~~ ✅ BEHOBEN (19.04)**
- ~~6 Timer liefen parallel, gleichzeitiges saveState konnte Daten verlieren~~
- **Behoben:** Save-Queue mit Mutex + Debounced-Save-Variante für hochfrequente Updates

**4. Kein Structured JSON Output ~~~~ ✅ BEHOBEN (19.04)**
- ~~JSON.parse ohne robusten Fallback, Markdown-Fences crashten Parser~~
- **Behoben:** 3-stufiger Fallback (Direct Parse → Balanced Brace Parser → Regex Key-Value). OpenAI `response_format: json_object` aktiviert.

**5. Ensemble mittelt bei Konflikten ~~~~ ✅ BEHOBEN (19.04)**
- ~~Bei OpenAI 70% + Gemini 40% → 55% (schlechtester Fall)~~
- **Behoben:** Disagreement-Detection. Bei Spread >40% = `critical_disagreement` → Trade blockiert. Bei >25% = Confidence reduziert um 25%. Feld `disagreement: low/high/critical` in jeder Prediction.

**6. Cold-Start Problem ~~~~ ✅ BEHOBEN (19.04)**
- ~~Bot startet ohne Daten, verliert 5 Trades zufällig, lernt verzerrt~~
- **Behoben:** Erste 5 Trades mit `cold_start_size_factor: 0.5` (halbe Größe). Wird in Empfehlungen und Manual-Plänen automatisch angewendet. UI zeigt "❄️ Cold-Start aktiv".

**7. Source-Credibility Cold-Start ~~~~ ✅ BEHOBEN (20.04)**
- ~~Bis Quelle 3 Trades hatte, wurde sie neutral behandelt (Reuters = Reddit)~~
- **Behoben:** `SOURCE_TIERS` Map mit 20+ Domains (Reuters/Bloomberg=0.65, BBC/CNBC=0.57, Reddit=0.50). Blended Score: bei <20 Outcomes Mix aus Default-Tier + gelerntem Score, ab 20 rein gelernt. Neue Quellen bekommen automatisch sinnvolle Startwerte.

### 🟢 NICE-TO-HAVE

**8. Keine Mobile-Ansicht**
- Dashboard Desktop-only, Tabellen überlappen auf Phones
- **TODO:** Responsive Breakpoints, vertikale Card-Layouts auf <768px

**9. Rate Limiting ~~~~ ✅ BEHOBEN (19.04)**
- ~~Jeder mit public IP konnte Bot hämmern~~
- **Behoben:** Opt-in Rate Limiter (`rate_limit_enabled` in Einstellungen → System)

**10. state.json bei jedem Tick geschrieben ~~~~ ✅ TEILWEISE BEHOBEN (19.04)**
- ~~~5-10 MB JSON alle 10 Sek komplett neu~~
- **Behoben:** `saveStateDebounced()` + `flushDebouncedSave()` verfügbar, 2-Sek Throttle
- **TODO:** In alle Timer einbauen (aktuell nur saveState verwendet)

**11. Tokenize ohne Stemming ~~~~ ✅ BEHOBEN (19.04)**
- ~~"election", "elections", "elected" als 3 verschiedene Keywords~~
- **Behoben:** Simple Stemmer in utils.js

**12. Open Trades nicht sofort resolved bei Neustart ~~~~ ✅ BEHOBEN (19.04)**
- ~~Bei Server-Crash während Trade: erst nächster 10s-Tick~~
- **Behoben:** Startup resolved abgelaufene Binary-Trades sofort

**13. Keine Currency-Correlation-Erkennung bei Forex ~~~~ ✅ BEHOBEN (19.04)**
- ~~EUR/USD + GBP/USD gleichzeitig = doppeltes USD-Risk~~
- **Behoben:** `forex_correlation_check` (true). Pro-Trades werden blockiert die Währungsexposure verdoppeln würden.

**14. Kein Backtest-Modus ~~~~ ✅ BEHOBEN (20.04)**
- ~~Keine Möglichkeit Strategien auf historischen Daten zu testen~~
- **Behoben:** Neuer Backtest-Tab mit 200-Kerzen-Historie, RSI+Trend Strategie, Wilson CI, Max Drawdown, Break-even-Vergleich. POST `/api/forex/backtest` oder im Binary-Tab.

**15. Keine state.json Backups ~~~~ ✅ BEHOBEN (19.04)**
- ~~Korruption der state.json bedeutete kompletter Datenverlust~~
- **Behoben:** Automatisches tägliches Backup in `data/backups/state-YYYY-MM-DD.json`. 7 letzte Backups werden behalten. Bei Parse-Fehler wird automatisch vom letzten Backup recovert.

### 🆕 NEUE BEKANNTE SCHWÄCHEN (aus Deep-Audit)

**16. Silent `catch {}` in kritischen Pfaden ~~~~ ✅ TEILWEISE BEHOBEN (20.04)**
- ~~News-Fetch-Fehler wurden still geschluckt~~
- **Behoben:** 4 kritische Silent-Catches ersetzt durch `pushLiveComm` (news_fetch_error, price_fetch_error, news_impact_log_error). Fehler jetzt im Live-Log sichtbar.
- **Rest:** ~10 verbleibende Silent-Catches sind fail-safe (OK zu behalten)

**17. Kein Kalshi-Execution**
- Bot kann Kalshi-Märkte scannen aber keine Orders senden (nur Polymarket + Paper)
- **TODO:** Kalshi API Integration in execution.js

**18. /api/state liefert komplette state.json**
- Bei 10MB State wird alle paar Sekunden ~10MB durchs Netz geschickt
- **TODO:** Partial updates, oder Redis für heiße Daten

**19. API-Quota-Tracking ~~~~ ✅ BEHOBEN (20.04)**
- ~~TwelveData 800/Tag wurde nicht aktiv getrackt~~
- **Behoben:** Counter pro Provider pro Tag in `state.api_quota`. Warnung bei 80% (pushLiveComm), Hard-Stop bei 100%, auto-Reset um Mitternacht UTC. Endpoint `GET /api/quota` zeigt aktuellen Status.

**20. Health-Check-Endpoint ~~~~ ✅ BEHOBEN (20.04)**
- ~~Kein `/health` Endpoint für externes Monitoring~~
- **Behoben:** `GET /health` liefert Status, Uptime, Memory, Bankrolls, offene Trades, Trade-Historie, API-Quota, letzte LLM-Anfrage. Perfekt für UptimeRobot / Grafana.

**21. Sekundengenaues Timing auf Forex-Signalen ~~~~ ✅ BEHOBEN (20.04)**
- ~~Bot nutzte 5min-Kerzen — Entry-Preis konnte bis zu 5 Min "alt" sein~~
- **Behoben:** Vor jedem Manual Plan wird automatisch ein frischer 1-min Candle gefetcht. Plan speichert `signal_price` (alt) vs `current_price` (frisch) und `price_age_sec`. Flag `price_was_refreshed: true` wenn erfolgreich.

### UPDATE LOG

**20.04.2026** — Release 4.0.4
- ✅ Fix #7: Source-Credibility Tier-Defaults (Reuters/Bloomberg=0.65, Reddit=0.50, Blended bei <20 Outcomes)
- ✅ Fix #16: Silent Catches in kritischen Pfaden ersetzt durch pushLiveComm
- ✅ Fix #19: API-Quota-Tracking pro Provider mit 80% Warnung und 100% Hard-Stop
- ✅ Fix #20: `/health` Endpoint für externes Monitoring + `/api/quota`

**20.04.2026** — Release 4.0.3
- ✅ Fix #2: Statistische Signifikanz mit Wilson CI + erhöhte Thresholds (10+ statt 3-5)
- ✅ Fix #14: Backtest-Modus mit RSI+Trend Strategie, 200 Kerzen, CI & Drawdown
- ✅ Fix #21: Real-time Price Check vor Manual Plans

**19.04.2026** — Release 4.0.2
- ✅ Fix #1: Spread/Slippage-Simulation
- ✅ Fix #4: Robuste JSON-Extraktion + OpenAI json_object
- ✅ Fix #5: Ensemble Disagreement Detection
- ✅ Fix #6: Cold-Start Strategy (erste 5 Trades × 0.5 Size)
- ✅ Fix #10: saveStateDebounced Funktion
- ✅ Fix #13: Currency-Correlation-Check für Pro
- ✅ Fix #15: Auto-Backup + Recovery
- ✅ Neu: Custom Payout % pro Manual Trade (0-92%)

**19.04.2026** — Release 4.0.1
- ✅ Fix #3: Save-Queue gegen Race Condition
- ✅ Fix #9: Rate Limiting (opt-in)
- ✅ Fix #11: Tokenize mit Stemming
- ✅ Fix #12: Open Trades beim Startup resolven
- ✅ Neu: Manuelles Trading (Bot plant, du tradest extern)

---

## Disclaimer

**Ausschließlich für Bildungs- und Forschungszwecke.** Der Bot tradet im Paper-Modus (simuliert). Trading mit echtem Geld birgt erhebliche finanzielle Risiken. Vergangene Performance (auch in Backtests) garantiert keine zukünftigen Ergebnisse. Binary Options sind in vielen Ländern reguliert oder verboten. Prüfe die Rechtslage in deinem Land.

---

V4.0 — April 2026 | 23 Backend-Module | 9 Tabs | 8 Self-Learning Loops | 6 LLM-Provider | 16 News-Quellen
