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

echo "[startup] Iniciando Next.js en puerto 3001..."
node ./node_modules/.bin/next start -H 0.0.0.0 -p 3001 &

echo "[startup] Esperando Next.js..."
sleep 3

echo "[startup] Iniciando proxy reverso en puerto 3000..."
exec node proxy-server.js
