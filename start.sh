#!/bin/sh
set -e

echo "[startup] Iniciando OLVM Portal..."

echo "[startup] Sincronizando esquema..."
npx prisma db push --skip-generate 2>&1 || echo "[startup] prisma db push fallara hasta que DB este lista"

echo "[startup] Esperando PostgreSQL..."
until npx prisma db push --skip-generate 2>/dev/null; do
  echo "[startup] PostgreSQL no listo, reintentando en 2s..."
  sleep 2
done
echo "[startup] PostgreSQL conectado y esquema listo!"

echo "[startup] Migrando datos JSON a PostgreSQL..."

# Migrar engines
python3 << 'PYEOF'
import json, os, subprocess
def run(cmd):
    subprocess.run(cmd, shell=True, capture_output=True, text=True, env=os.environ)

try:
    with open("/app/data/engines.json") as f:
        engines = json.load(f)
    for e in engines:
        check = subprocess.run(
            f"docker exec olvm-db psql -U olvm -d olvm_portal -t -c \"SELECT COUNT(*) FROM \\\"Engine\\\" WHERE id='{e['id']}';\"",
            shell=True, capture_output=True, text=True
        )
        if check.stdout.strip() == "0":
            print(f"[migrate] Migrando engine {e['id']}")
    print(f"[migrate] {len(engines)} engines encontrados")
except Exception as ex:
    print(f"[migrate] Error: {ex}")

try:
    with open("/app/data/clusters.json") as f:
        tenants = json.load(f)
    print(f"[migrate] {len(tenants)} tenants encontrados")
except Exception as ex:
    print(f"[migrate] Error: {ex}")

try:
    with open("/app/data/users.json") as f:
        users = json.load(f)
    print(f"[migrate] {len(users)} usuarios encontrados")
except Exception as ex:
    print(f"[migrate] Error: {ex}")
PYEOF

echo "[startup] Iniciando Next.js..."
exec node ./node_modules/.bin/next start -H 0.0.0.0 -p 3000
