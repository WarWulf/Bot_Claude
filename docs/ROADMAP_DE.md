# Schritt-für-Schritt Plan (Ollama Cloud + kimi-k2.5 + JSX UI)

## 1) VPS Basis
1. Ubuntu 22.04/24.04 installieren.
2. Firewall öffnen: `22`, `80`, `443`, optional `5173` nur intern.
3. Reverse Proxy (Nginx/Caddy) einrichten und TLS aktivieren.

## 2) Projekt starten
1. `.env.example` nach `.env` kopieren.
2. API Keys für Polymarket/Kalshi + Ollama Cloud Token ergänzen.
3. `docker compose up -d` starten.

## 3) UI über IP/DNS erreichbar machen
1. Frontend über Nginx auf `http://<VPS-IP>` oder Domain routen.
2. Backend nur intern freigeben (empfohlen).
3. CORS nur für UI-Domain/IP erlauben.

## 4) Pipeline schrittweise ausbauen
1. **Scan**: `/api/scan` von Mock auf echte API-Clients umstellen.
2. **Research**: News/Social Ingestion als Worker hinzufügen.
3. **Predict**: Ensemble-Endpoint bauen (`/api/predict`) mit Kalibrierung/Brier-Tracking.
4. **Risk+Execution**: Deterministische Checks als eigenes Modul + Order Router.
5. **Compound**: Trade-Log + nightly review + failure knowledge base.

## 5) Sicherheitsbasis
- Kill-Switch Datei (`STOP`) implementieren.
- Daily loss limit + API-cost ceiling erzwingen.
- Demo/Paper-Trading vor Echtgeld.
