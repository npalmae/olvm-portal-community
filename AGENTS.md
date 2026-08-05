# OLVM Portal - Contexto del Proyecto

## Infraestructura

| Componente | URL / IP | Notas |
|------------|----------|-------|
| Bastion (staging) | `http://10.176.160.124:3000` | Contenedor `olvm-portal`, deploy path `/home/npalma/olvm-portal` |
| Portal Público | `https://olvmportal.sixmanager.io` | Contenedor separado en `10.176.160.41` |
| OLVM Engine | `https://10.141.11.63/ovirt-engine/api` | API REST oVirt v4 |
| OLVM Host | `10.141.11.60` | ID `fbad1a2a-2413-453a-b42d-3472c6713254` |
| SSH Bastion | `npalma@10.176.160.124` | Password: ver variable de entorno |
| SSH Portal Público | `npalma@10.176.160.41` | Mismo password |

## Regla de Despliegue

1. Desplegar primero en Bastion (`10.176.160.124`).
2. Validar funcionalidad.
3. Luego desplegar en Portal Público (`10.176.160.41`) cuando el usuario lo solicite.

## Wasabi S3 Backup

- **Bucket:** `olvm-portal`
- **Access Key:** `25VB21V207WC5NPG15VS`
- **Secret Key:** `JhJyVoKPt8FDnMXspqKppeCECC8znZZw6Il71WGy`
- **Endpoint:** `s3.us-central-1.wasabisys.com`
- **Region:** `us-central-1`
- **Estructura:** `s3://olvm-portal/backups/YYYY-MM-DD/portal-{bastion|public}/`
  - `olvm-portal-docker-image.tar.gz` — `docker save | gzip`
  - `olvm-portal-postgres.sql.gz` — `docker exec olvm-db pg_dump -U olvm olvm_portal | gzip`
  - `olvm-portal-source.tar.gz` — source sin `node_modules`, `.next`, `ova-staging`
  - `portal-{bastion|public}-data.tar.gz` — `data/` del contenedor (users.json, clusters.json, api-keys.json)
  - `SHA256SUMS` — checksums
- Credenciales ya configuradas en `~/.aws/credentials` del Bastion y Portal Público.

## GitHub

- **Repo:** `https://github.com/npalmae/olvm-portal.git`
- **Rama:** `main`
- Commit y push después de cada cambio validado.

## Docker en Bastion

- `docker-compose` v1.29.2 (uso: `docker-compose`, no `docker compose`)
- Bug conocido: `ContainerConfig` KeyError al recrear contenedores. Workaround: `docker stop && docker rm` antes de `docker-compose up -d`.
- Builds largos (>10 min): usar `screen -dmS build` para evitar kill por timeout SSH.
- Prisma: requiere `binaryTargets = ["native", "debian-openssl-3.0.x"]` en `schema.prisma`.

## Arquitectura del Portal

- **Framework:** Next.js 15 (App Router, SSR)
- **Auth:** NextAuth.js (JWT + 2FA vía Resend email OTP)
- **DB:** PostgreSQL 16 (contenedor `olvm-db`)
- **Multi-tenant:** Aislamiento por tags OLVM. Cada tenant tiene un tag único por engine.
- **Roles:** `superadmin` (global), `admin` y `user` (por tenant)
- **API read-only:** `/api/v1/*` con header `X-API-Key`
- **Consola:** noVNC embebida + proxy WS en puerto 3010

## Funcionalidades Clave

- Upload y catálogo de OVAs (chunks 50 MB, almacenados en storage domain del tenant)
- Import OVA → VM (conversión manual VMDK→QCOW2, SCP al host, image transfer)
- Upload de ISOs (image transfer API)
- Consola VNC embebida con proxy
- API read-only documentada con API keys por usuario

## Comandos Útiles

```bash
# Lint (requiere eslint config migration)
npm run lint

# Build
npm run build

# Tests
npm test -- --run

# Type check
npx tsc --noEmit

# Deploy a Bastion (rsync archivos cambiados + rebuild)
SSHPASS='...' sshpass -e ssh npalma@10.176.160.124 'cd /home/npalma/olvm-portal && docker-compose build portal'
# Si ContainerConfig error:
docker stop olvm-portal && docker rm olvm-portal && docker-compose up -d portal

# Backup a Wasabi
docker save olvm-portal_portal:latest | gzip > /tmp/olvm-portal-docker-image.tar.gz
docker exec olvm-db pg_dump -U olvm olvm_portal | gzip > /tmp/olvm-portal-postgres.sql.gz
aws s3 cp /tmp/olvm-bkp/ s3://olvm-portal/backups/YYYY-MM-DD/portal-bastion/ --recursive --endpoint-url https://s3.us-central-1.wasabisys.com
```

## Docker en Portal Público (10.176.160.41)

- `docker compose` v2.40 (uso: `docker compose`, no `docker-compose`)
- Requiere `sudo` para docker
- Imagen: `olvm-portal-portal:latest`
- `docker-compose.yml` ya en v2 (sin `version: "3.8"`)

## Usuarios del Portal Público (preservar siempre)

| Email | Rol | Tenant |
|-------|-----|--------|
| super@test.com | superadmin | — |
| npalma@sixmanager.com | superadmin | — |
| cfonseca@sixmanager.com | superadmin | produccion |
| sistemas@sixmanager.com | user | produccion |
| proyectos@sixmanager.com | admin | cliente1 |
| spalma@sixmanager.com | user | cliente1 |
| jfarias@sixmanager.com | superadmin | produccion |
| emunoz@sixmanager.com | superadmin | produccion |
| fespinoza@sixmanager.com | superadmin | produccion |
| jpalma@sixmanager.com | superadmin | produccion |
| user-a@sixmanager.com | user | produccion |
| user-b@sixmanager.com | user | desarrollo |

## Sincronización Bastion → Público

Al desplegar en el público, SIEMPRE preservar:
- `.env` (tiene AUTH_URL y CONSOLE_PROXY distintos)
- `data/users.json` (12 usuarios reales)
- `data/clusters.json`, `data/engines.json`, `data/api-keys.json`
- `docker-compose.yml` (POSTGRES_VOLUME_NAME=olvm-portal_olvm-pgdata-41)

Procedimiento:
```bash
# 1. Respaldar público
ssh ... 'tar czf ~/olvm-portal-pub-backup-$(date +%Y%m%d).tar.gz ...'

# 2. Transferir código desde Bastion (excluyendo data, .env, compose)
ssh bastion 'tar czf /tmp/sync.tar.gz --exclude=data --exclude=.env --exclude=docker-compose.yml src prisma scripts ...'
ssh bastion 'sshpass scp /tmp/sync.tar.gz pub:/tmp/'

# 3. Extraer en público
ssh pub 'cd olvm-portal && tar xzf /tmp/sync.tar.gz'

# 4. Reconstruir
ssh pub 'sudo docker compose build portal && sudo docker compose up -d portal'
```

## Última sincronización: 2026-08-05

- Bastion commit: `1c02605 fix(security): close cross-tenant VM visibility`
- Público sincronizado al mismo nivel
- Features agregadas al público: OVA upload/import, API v1, API keys, security fixes

## Sesión archivada de OpenCode

- **Session ID principal:** `ses_10f0d91e2ffemrkP6dbYgmyQ96`
- **DB:** `/Users/nicolaspalma/.local/share/opencode/opencode.db`
- **Título:** OLVM-PORTAL
- **Partes:** 4682+ (mensajes + tool calls)
- Query para buscar contenido histórico:
```sql
sqlite3 ~/.local/share/opencode/opencode.db "
SELECT datetime(p.time_created/1000,'unixepoch','localtime'), substr(p.data,1,500)
FROM part p JOIN message m ON p.message_id = m.id
WHERE m.session_id = 'ses_10f0d91e2ffemrkP6dbYgmyQ96'
AND p.data LIKE '%TERMINO_BUSQUEDA%'
ORDER BY p.time_created ASC"
```
