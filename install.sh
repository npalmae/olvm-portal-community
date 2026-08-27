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

echo -e "${BLUE}▶ Verificando prerequisitos...${NC}"
echo

PREREQ_OK=true

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  echo -e "  ${BLUE}→${NC} Docker no encontrado. Instalando..."
  # Reparar dpkg si quedó interrumpido (común tras instalaciones fallidas)
  if command -v dpkg >/dev/null 2>&1; then
    sudo dpkg --configure -a >/dev/null 2>&1 || true
  fi
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y -qq ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update -qq && sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable --now docker
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y -q yum-utils
    sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo yum install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable --now docker
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y -q dnf-plugins-core
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable --now docker
  else
    echo -e "  ${YELLOW}✗${NC} No se pudo instalar Docker automáticamente."
    echo -e "     Instalalo manualmente: https://docs.docker.com/engine/install/"
    PREREQ_OK=false
  fi
fi

# Verificar permisos de Docker (sea recién instalado o preexistente)
if command -v docker >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} Docker: $(docker --version 2>/dev/null | head -c 60)"
  if ! docker ps >/dev/null 2>&1; then
    echo -e "  ${BLUE}→${NC} Agregando usuario '$USER' al grupo docker..."
    sudo usermod -aG docker "$USER" 2>/dev/null || true
    # Re-ejecutar el script con los permisos del grupo docker aplicados
    if ! docker ps >/dev/null 2>&1; then
      echo -e "  ${YELLOW}!${NC} Re-ejecutando con permisos actualizados..."
      exec sg docker -c "$0" || {
        echo -e "  ${YELLOW}!${NC} No se pudo aplicar el grupo automáticamente."
        echo -e "     Ejecutá manualmente: sudo usermod -aG docker \$USER && newgrp docker"
        echo -e "     Y volvé a correr: ./install.sh"
        exit 1
      }
    fi
  fi
else
  PREREQ_OK=false
fi

# 2. Docker Compose
COMPOSE=""
if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
elif docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE=""
fi
if [ -n "$COMPOSE" ]; then
  echo -e "  ${GREEN}✓${NC} Docker Compose: $COMPOSE"
else
  echo -e "  ${YELLOW}✗${NC} Docker Compose: no instalado"
  echo -e "     Instalar: https://docs.docker.com/compose/install/"
  PREREQ_OK=false
fi

# 3. OpenSSL (generación de secretos)
if command -v openssl >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} OpenSSL: $(openssl version 2>/dev/null | head -c 30)"
else
  echo -e "  ${YELLOW}!${NC} OpenSSL: no encontrado (se usará /dev/urandom como fallback)"
fi

# 4. Puerto 3000 libre
if ss -tlnp 2>/dev/null | grep -q ':3000 ' || netstat -tlnp 2>/dev/null | grep -q ':3000 '; then
  echo -e "  ${YELLOW}!${NC} Puerto 3000: en uso (verificá que no haya otra instancia del portal)"
else
  echo -e "  ${GREEN}✓${NC} Puerto 3000: libre"
fi

# 5. Espacio en disco (mínimo 5 GB)
AVAILABLE_GB=$(df -BG . 2>/dev/null | awk 'NR==2 {gsub("G","",$4); print $4}')
if [ -n "$AVAILABLE_GB" ] && [ "$AVAILABLE_GB" -lt 5 ] 2>/dev/null; then
  echo -e "  ${YELLOW}✗${NC} Espacio en disco: ${AVAILABLE_GB} GB (se recomiendan al menos 5 GB)"
  PREREQ_OK=false
elif [ -n "$AVAILABLE_GB" ]; then
  echo -e "  ${GREEN}✓${NC} Espacio en disco: ${AVAILABLE_GB} GB disponibles"
else
  echo -e "  ${GREEN}✓${NC} Espacio en disco: no se pudo verificar (continuando)"
fi

# 6. RAM (mínimo 2 GB)
TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/ {print $2}')
if [ -n "$TOTAL_RAM_MB" ] && [ "$TOTAL_RAM_MB" -lt 1800 ] 2>/dev/null; then
  echo -e "  ${YELLOW}!${NC} RAM: ${TOTAL_RAM_MB} MB (se recomiendan al menos 2 GB)"
elif [ -n "$TOTAL_RAM_MB" ]; then
  echo -e "  ${GREEN}✓${NC} RAM: ${TOTAL_RAM_MB} MB"
fi

echo

# Información de lo que vas a necesitar a mano para el wizard web
echo -e "${BLUE}ℹ  Datos que vas a necesitar para el wizard web:${NC}"
echo -e "   • URL del motor OLVM/oVirt (ej: https://engine.example.com/ovirt-engine/api)"
echo -e "   • Credenciales del engine (usuario + password)"
echo -e "   • Nombre y tag del tenant"
echo -e "   • (Opcional) API key de Resend + email remitente"
echo -e "   • (Opcional) Credenciales SSH de los hosts OLVM"
echo

if [ "$PREREQ_OK" = false ]; then
  echo -e "${YELLOW}✗ Faltan prerequisitos obligatorios. Instalalos y volvé a ejecutar.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Prerequisitos OK${NC}"
echo

# ── .env ─────────────────────────────────────────────────────────────────────

ENV_FILE=".env"

rand_b64() {
  openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64
}
rand_hex() {
  openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -A n -t x1 | tr -d ' \n'
}

# Función para leer un valor del .env
env_get() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
# Función para setear/reescribir un valor en el .env
env_set() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

NEEDS_SECRETS=false
if [ ! -f "$ENV_FILE" ]; then
  NEEDS_SECRETS=true
  touch "$ENV_FILE"
elif [ -z "$(env_get AUTH_SECRET)" ] || [ -z "$(env_get FIELD_ENCRYPTION_KEY)" ] || [ -z "$(env_get DB_PASSWORD)" ]; then
  echo -e "${YELLOW}ℹ  $ENV_FILE existe pero le faltan secretos. Completando...${NC}"
  NEEDS_SECRETS=true
fi

if [ "$NEEDS_SECRETS" = true ]; then
  echo -e "${BLUE}▶ Generando secretos de bootstrap...${NC}"

  # Generar solo los que faltan (no pisar los existentes)
  if [ -z "$(env_get AUTH_SECRET)" ]; then env_set "AUTH_SECRET" "$(rand_b64)"; fi
  if [ -z "$(env_get FIELD_ENCRYPTION_KEY)" ]; then env_set "FIELD_ENCRYPTION_KEY" "$(rand_b64)"; fi
  if [ -z "$(env_get DB_PASSWORD)" ]; then env_set "DB_PASSWORD" "$(rand_hex)"; fi

  # Asegurar variables obligatorias restantes
  env_set "AUTH_TRUST_HOST" "true"
  env_set "REQUIRE_2FA" "false"
  env_set "OVA_STAGING_DIR" "/mnt/ova"
  env_set "OVA_HOST_STAGING_DIR" "/mnt/ova"
  env_set "OVA_STAGING_HOST_PATH" "./data/ova-staging"

  # Preguntar URL si no está seteada o es localhost
  CURRENT_URL="$(env_get AUTH_URL)"
  if [ -z "$CURRENT_URL" ] || [[ "$CURRENT_URL" == *"localhost"* ]]; then
    DEFAULT_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    [ -z "$DEFAULT_IP" ] && DEFAULT_IP="localhost"
    DEFAULT_URL="http://${DEFAULT_IP}:3000"
    echo
    read -rp "URL pública del portal [${DEFAULT_URL}]: " AUTH_URL || true
    AUTH_URL="${AUTH_URL:-$DEFAULT_URL}"
    env_set "AUTH_URL" "$AUTH_URL"
    env_set "NEXTAUTH_URL" "$AUTH_URL"
  fi

  mkdir -p data/ova-staging
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo -e "${GREEN}✓ $ENV_FILE listo${NC}"
else
  echo -e "${GREEN}✓${NC} $ENV_FILE ya tiene secretos válidos — se reutiliza."
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
