#!/bin/sh
set -e

echo "[startup] Iniciando OLVM Portal..."

echo "[startup] Esperando PostgreSQL..."
until node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.$queryRawUnsafe("SELECT 1").then(()=>p.$disconnect()).catch(async()=>{await p.$disconnect();process.exit(1)})' 2>/dev/null; do
  echo "[startup] PostgreSQL no listo, reintentando en 2s..."
  sleep 2
done
echo "[startup] PostgreSQL conectado. Aplicando migraciones..."
./node_modules/.bin/prisma migrate deploy
echo "[startup] Esquema listo!"

echo "[startup] Iniciando Next.js en puerto 3001..."
node ./node_modules/.bin/next start -H 0.0.0.0 -p 3001 &

echo "[startup] Esperando Next.js..."
sleep 3

echo "[startup] Iniciando scheduler de backups..."
node ./scripts/backup-scheduler.cjs &

echo "[startup] Iniciando proxy reverso en puerto 3000..."
exec node proxy-server.js
