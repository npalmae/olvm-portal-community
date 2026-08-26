# OLVM Portal - Contexto del Proyecto

## Infraestructura

| Componente | URL / IP | Notas |
|------------|----------|-------|
| Bastion (staging) | `http://10.176.160.124:3000` | Contenedor `olvm-portal`, deploy path `/home/npalma/olvm-portal` |
| Portal Público | `https://olvmportal.sixmanager.io` | Contenedor separado en `10.176.160.41` |
| OLVM Engine | `https://10.141.11.63/ovirt-engine/api` | API REST oVirt v4 |
| OLVM Host | `10.141.11.60` | ID `fbad1a2a-2413-453a-b42d-3472c6713254` |
| SSH Bastion | `npalma@10.176.160.124` | Usar credencial administrada fuera del repositorio |
| SSH Portal Público | `npalma@10.176.160.41` | Usar credencial administrada fuera del repositorio |

## Regla de Despliegue

1. Desplegar primero en Bastion (`10.176.160.124`).
2. Validar funcionalidad.
3. Luego desplegar en Portal Público (`10.176.160.41`) cuando el usuario lo solicite.

## Wasabi S3 Backup

- **Bucket:** `olvm-portal`
- **Credenciales:** configuradas fuera del repositorio en `~/.aws/credentials`
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
- **Roles:** `superadmin` (global), `admin`, `user` y `operator` (solo lectura) por tenant
- **Visibilidad de operaciones:** norma por tenant, no por usuario. Todos los miembros con acceso al tenant ven acciones, progreso, estado y origen; la barra muestra alias y la auditoría conserva el correo real.
- **API:** `/api/v1/*` con header `X-API-Key`; incluye lectura y operaciones controladas por rol.
- **Consola:** noVNC embebida + proxy WS en puerto 3010

## Funcionalidades Clave

- Upload y catálogo de OVAs (chunks 50 MB, almacenados en storage domain del tenant)
- Import OVA → VM (conversión manual VMDK→QCOW2, SCP al host, image transfer)
- Upload de ISOs (image transfer API)
- Consola VNC embebida con proxy
- API documentada con API keys por usuario
- Operaciones persistentes (`OperationJob`) visibles por tenant con progreso y alias del ejecutor

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

## Estado actual: 2026-08-26

- Stack de dependencias actualizado y validado en Bastion y producción:
  - Next `16.3.3`, React/React DOM `19.2.8`, next-auth `5.0.0-beta.32`, Prisma/client `6.19.3` (Prisma 7 diferido), noVNC `1.7.0` (import raíz `@novnc/novnc`), Sharp `0.35.4`, Undici `8.10.0` (con `undici.fetch` para dispatchers), TypeScript `6.0.3`, Node `22.23.2` (imagen pinned por digest multi-arch), PostgreSQL `16.15-alpine` (digest).
  - `src/middleware.ts` renombrado a `src/proxy.ts` (convención Next 16).
  - Lockfile regenerado y reproducible (`npm ci`); Docker usa `npm ci`; eliminados `cross-env`, `bufferutil`, `utf-8-validate` y `scripts/patch-novnc.cjs`.
  - `docker-compose.yml` exige `DB_PASSWORD` obligatoria en `.env`.
  - `npm audit --omit=dev`: 3 high conocidos vía `@prisma/config`/`deepmerge-ts` (CLI Prisma, config local confiable; no aplicar `npm audit fix --force`).
  - Lint plano informativo con 126 hallazgos preexistentes; no es bloqueante de release.
- Validación: `tsc` OK, 80/80 tests, build Next 16 OK, imagen Docker OK; pendiente prueba real de consola noVNC y E2E OLVM en uso.
- Bastion (`10.176.160.124`): Ubuntu 24.04.4 kernel `6.8.0-138`, SO al día, portal Next 16 desplegado, 12 usuarios/3 tenants preservados.
- Público (`10.176.160.41`): Ubuntu 22.04.5 kernel `5.15.0-190`, SO al día, portal Next 16 desplegado, 12 usuarios/3 tenants preservados; `https://olvmportal.sixmanager.io` y `https://olvm-portal.sixmanager.io` en `200`.
- Túnel Cloudflare `olvm-portal-sixmanager` (`d5730207-b36c-45ae-aaf8-a592447e87f0`): conector `cloudflare/cloudflared:2026.8.2`, `--network host`, `healthy`. Token del conector en `/etc/cloudflared/olvm-portal.token` (0400, uid 65532) montado read-only en `/run/secrets/olvm-portal.token`; se recupera vía API `GET /accounts/{account}/cfd_tunnel/{id}/token` con un API Token con permiso Cloudflare Tunnel.
- DNS del host público: gateway `10.111.126.1` intermittente tras reinicio; añadidos `1.1.1.1`/`1.0.0.1` en netplan (`50-cloud-init.yaml`, respaldo `.bak-pre-dnsfix`) y `FallbackDNS` en `resolved.conf`.
- Respaldos del día en `s3://olvm-portal/backups/2026-08-26/portal-bastion/` (y copia local `/home/npalma/backups/2026-08-26/portal-public/` en `.41`).
- Norma de visibilidad: operaciones visibles por tenant; se muestra alias del ejecutor y el correo real solo queda en auditoría.
- Pendiente: rotar API tokens/secretos expuestos en conversaciones; suite Playwright E2E inexistente; consola noVNC 1.7.0 requiere prueba manual real (teclado, clipboard, resize, reconexión).

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
