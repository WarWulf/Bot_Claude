#!/bin/bash
# =============================================================
# Tradingbot VPS Deployment Script
# Run this ON your VPS after SSH login
# Usage: bash deploy.sh
# =============================================================

set -e

echo ""
echo "=========================================="
echo "  Tradingbot V4.0 — VPS Deployment"
echo "=========================================="
echo ""

# --- 1. System-Updates ---
echo "[1/6] System updaten..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# --- 2. Docker installieren (falls noch nicht vorhanden) ---
if ! command -v docker &> /dev/null; then
  echo "[2/6] Docker installieren..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER
  echo "  ✓ Docker installiert"
  echo "  ⚠ Falls 'permission denied' Fehler kommen: einmal ausloggen und neu einloggen, dann Script nochmal starten."
else
  echo "[2/6] Docker bereits installiert ✓"
fi

# Docker Compose prüfen
if ! docker compose version &> /dev/null; then
  echo "  Docker Compose Plugin installieren..."
  sudo apt-get install -y -qq docker-compose-plugin
fi

# --- 3. Repo klonen ---
echo "[3/6] Repository klonen..."
REPO_URL="${1:-https://github.com/WarWulf/Bot_Claude.git}"
BRANCH="${2:-main}"
APP_DIR="$HOME/tradingbot"

if [ -d "$APP_DIR" ]; then
  echo "  Ordner $APP_DIR existiert bereits."
  echo "  Mache git pull..."
  cd "$APP_DIR"
  git fetch --all
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
echo "  ✓ Repo bereit in $APP_DIR"

# --- 4. .env erstellen ---
echo "[4/6] Konfiguration..."
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "  ✓ .env aus .env.example erstellt"
  else
    cat > .env << 'ENVEOF'
# === Tradingbot Konfiguration ===

# UI-Passwort (UNBEDINGT ÄNDERN!)
UI_PASSWORD=changeme

# Port
PORT=8080

# === LLM Provider (optional, einer reicht) ===
# OpenAI
# OPENAI_API_KEY=sk-...

# Anthropic Claude
# CLAUDE_API_KEY=sk-ant-...

# Google Gemini
# GEMINI_API_KEY=AI...

# Ollama Cloud
# OLLAMA_CLOUD_API_KEY=...

# === Prediction Market APIs (optional, für später) ===
# POLYMARKET_WALLET_ADDRESS=
# POLYMARKET_EIP712_SIGNATURE=
# KALSHI_KEY_ID=
# KALSHI_KEY_SECRET=
ENVEOF
    echo "  ✓ .env erstellt"
  fi
  echo ""
  echo "  ⚠ WICHTIG: Passwort ändern!"
  echo "    nano $APP_DIR/.env"
  echo "    → UI_PASSWORD=dein-sicheres-passwort"
  echo ""
else
  echo "  ✓ .env existiert bereits"
fi

# --- 5. Docker starten ---
echo "[5/6] Docker Container starten..."
docker compose down 2>/dev/null || true
docker compose build --quiet
docker compose up -d

# --- 6. Status prüfen ---
echo "[6/6] Status prüfen..."
sleep 5

echo ""
echo "=========================================="
echo "  Container Status:"
echo "=========================================="
docker compose ps
echo ""

# Health-Check
HEALTH=$(curl -s http://localhost:8080/api/health 2>/dev/null || echo "nicht erreichbar")
echo "Backend Health: $HEALTH"
echo ""

# IP ermitteln
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo "=========================================="
echo "  ✓ Deployment fertig!"
echo "=========================================="
echo ""
echo "  Frontend:  http://$VPS_IP:5173"
echo "  Backend:   http://$VPS_IP:8080/api/health"
echo ""
echo "  Nächste Schritte:"
echo "  1. Passwort ändern:  nano $APP_DIR/.env"
echo "  2. Neu starten:      cd $APP_DIR && docker compose restart"
echo "  3. Logs anschauen:   docker compose logs -f"
echo "  4. Stoppen:          docker compose down"
echo ""
