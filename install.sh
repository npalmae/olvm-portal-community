#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   OLVM Portal — Instalador interactivo     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo

# ── Prerequisitos ────────────────────────────────────────────────────────────

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${YELLOW}✗ Docker no está instalado. Instálalo primero:${NC}"
  echo "   https://docs.docker.com/engine/install/"
  exit 1
fi

COMPOSE=""
if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
elif docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  echo -e "${YELLOW}✗ Docker Compose no está instalado.${NC}"
  exit 1
fi

echo -e "${BLUE}✓ Docker:${NC}   $(docker --version)"
echo -e "${BLUE}✓ Compose:${NC}  $COMPOSE"
echo

# ── .env ─────────────────────────────────────────────────────────────────────

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}ℹ  Ya existe $ENV_FILE — se reutiliza.${NC}"
  echo -e "   Para regenerar, eliminá el archivo y volvé a ejecutar."
else
  echo -e "${BLUE}▶ Generando secretos de bootstrap...${NC}"

  rand_b64() {
    openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64
  }
  rand_hex() {
    openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -A n -t x1 | tr -d ' \n'
  }

  AUTH_SECRET=$(rand_b64)
  FIELD_KEY=$(rand_b64)
  DB_PASS=$(rand_hex)

  DEFAULT_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -z "$DEFAULT_IP" ] && DEFAULT_IP="localhost"
  DEFAULT_URL="http://${DEFAULT_IP}:3000"

  echo
  read -rp "URL pública del portal [${DEFAULT_URL}]: " AUTH_URL
  AUTH_URL="${AUTH_URL:-$DEFAULT_URL}"

  mkdir -p data/ova-staging

  cat > "$ENV_FILE" <<EOF
# ── OLVM Portal .env — generado por install.sh — $(date) ──
# NO compartir este archivo. Permisos recomendados: 600.

# Bootstrap (obligatorios antes de arrancar)
AUTH_SECRET=${AUTH_SECRET}
FIELD_ENCRYPTION_KEY=${FIELD_KEY}
DB_PASSWORD=${DB_PASS}
AUTH_URL=${AUTH_URL}
NEXTAUTH_URL=${AUTH_URL}
AUTH_TRUST_HOST=true

# 2FA desactivado durante la instalación; se activa desde el wizard o el panel
REQUIRE_2FA=false

# Opcionales — se configuran desde el wizard web (/setup)
RESEND_API_KEY=
RESEND_FROM=
OLVM_TENANTS=
OLVM_HOST_SSH_USER=root
OLVM_HOST_SSH_PASSWORD=
API_READ_KEY=

# Staging OVA/qcow2
OVA_STAGING_DIR=/mnt/ova
OVA_HOST_STAGING_DIR=/mnt/ova
OVA_STAGING_HOST_PATH=./data/ova-staging
EOF
  chmod 600 "$ENV_FILE"
  echo -e "${GREEN}✓ $ENV_FILE generado${NC}"
fi

# ── Build + Start ────────────────────────────────────────────────────────────

echo
echo -e "${BLUE}▶ Construyendo e iniciando contenedores...${NC}"
echo "   (esto puede tardar varios minutos la primera vez)"
echo

$COMPOSE up -d --build

# ── Listo ────────────────────────────────────────────────────────────────────

# shellcheck disable=SC1090
source "$ENV_FILE" 2>/dev/null || true

echo
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ¡Contenedores iniciados!                 ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo
echo -e "${BLUE}Abrí el navegador en:${NC}"
echo -e "  ${GREEN}${AUTH_URL:-http://localhost:3000}/setup${NC}"
echo
echo -e "${BLUE}Completá la configuración desde el wizard web:${NC}"
echo -e "  1. Crear usuario superadmin"
echo -e "  2. Conectar motor OLVM"
echo -e "  3. Crear tenant + tag"
echo -e "  4. Email (opcional)"
echo -e "  5. SSH hosts OLVM (opcional)"
echo
