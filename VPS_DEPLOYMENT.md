# VPS Deployment Guide

## Was du brauchst
- Einen VPS (Hetzner, DigitalOcean, Contabo, etc.)
- Ubuntu 22.04 oder 24.04
- Mindestens 1 GB RAM, 1 CPU
- SSH-Zugang

## Option A: Ein-Befehl-Deployment (empfohlen)

SSH auf deinen VPS und dann:

```bash
# Direkt von GitHub deployen
curl -sL https://raw.githubusercontent.com/WarWulf/Tradingbot/MainV3.3/scripts/deploy.sh | bash
```

Oder wenn du das Script lieber vorher anschauen willst:

```bash
wget https://raw.githubusercontent.com/WarWulf/Tradingbot/MainV3.3/scripts/deploy.sh
cat deploy.sh          # anschauen
bash deploy.sh         # ausführen
```

## Option B: Manuell Schritt für Schritt

```bash
# 1. Docker installieren
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Einmal ausloggen und neu einloggen!

# 2. Repo klonen
git clone -b MainV3.3 https://github.com/WarWulf/Tradingbot.git ~/tradingbot
cd ~/tradingbot

# 3. Konfiguration
cp .env.example .env
nano .env
# → UI_PASSWORD ändern!

# 4. Starten
docker compose up -d

# 5. Prüfen
docker compose logs -f
```

## Nach dem Deployment

### Im Browser öffnen
- `http://DEINE-VPS-IP:5173` → Frontend/Dashboard
- `http://DEINE-VPS-IP:8080/api/health` → Backend prüfen

### Passwort ändern (WICHTIG!)
```bash
cd ~/tradingbot
nano .env
# UI_PASSWORD=dein-sicheres-passwort-mindestens-10-zeichen
docker compose restart
```

### Logs anschauen
```bash
cd ~/tradingbot
docker compose logs -f              # Alles
docker compose logs -f backend      # Nur Backend
docker compose logs -f frontend     # Nur Frontend
```

### Updaten (wenn du neue Änderungen pushst)
```bash
cd ~/tradingbot
git pull
docker compose down
docker compose build
docker compose up -d
```

### Stoppen
```bash
cd ~/tradingbot
docker compose down
```

## Firewall einrichten (empfohlen)

```bash
sudo ufw allow 22        # SSH
sudo ufw allow 5173      # Frontend
sudo ufw allow 8080      # Backend
sudo ufw enable
```

## Günstige VPS-Anbieter

| Anbieter | Kleinstes Paket | Preis/Monat |
|----------|----------------|-------------|
| Hetzner (CX22) | 2 CPU, 4 GB RAM | ~€4 |
| Contabo (VPS S) | 4 CPU, 8 GB RAM | ~€5 |
| DigitalOcean (Basic) | 1 CPU, 1 GB RAM | ~$6 |
| Linode (Nanode) | 1 CPU, 1 GB RAM | ~$5 |

Für den Bot reicht das kleinste Paket. Standort Europa oder US-East wählen (näher an den Market-APIs).
