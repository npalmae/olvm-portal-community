# Reglas de trabajo

- Antes de tomar cualquier determinación (cambios, despliegues, decisiones de diseño), revisar TODO el código relevante primero: leer los archivos completos, no solo greps puntuales ni fragmentos.
- Verificar siempre con `npx tsc --noEmit`, `npm test` y `npm run build` antes de commitear o desplegar (lint tiene errores pre-existentes: comparar contra la rama base, no introducir nuevos).
- Tras cambios en `prisma/schema.prisma`, correr `npx prisma generate` antes del typecheck.

# Contexto del proyecto

- **Repo de trabajo: `npalmae/virtual-portal`** ("VMware vSphere edition of the multi-tenant VM portal"). Es la base correcta: ya incluye `src/lib/vmwareClient.ts`, dispatcher de engine (Fase 0) y matriz de capacidades vSphere 7/8/9.
- Repos relacionados (no usar como base): `npalmae/olvm-portal` (fork oscuro) y `npalmae/olvm-portal-community` (original comunitario OLVM).
- Identidad visual: `src/app/globals.css` es la fuente de verdad de tokens (`--accent` violeta `#7c3aed`, sidebar `#1e2535`, Inter 13px). Ojo: muchos componentes usan clases Tailwind literales (violet-*) además de los tokens.
- Marca: "Virtual Portal" con ícono OvP (`public/ovp-favicon.svg`). Branding además configurable en runtime vía `/admin/branding`.
- Stack: Next.js 15 + Prisma + PostgreSQL 16 (`docker-compose` levanta `olvm-db` y `olvm-portal`, network host, puertos 3000/3010). `start.sh` espera la DB y corre `prisma migrate deploy` solo.
- Despliegue: servidor Ubuntu 26.04 por ZeroTier (10.176.160.85), código en `~/virtual-portal`, `.env` generado en el server (no pisarlo con rsync: excluir `.env`, `data`, `node_modules`, `.next`, `.git`).
- 2FA desactivado en el lab (`REQUIRE_2FA=false`); setup inicial vía `/setup`.
- Rama activa: `feat/virtual-identity` (base: `vp/main` @ f44f3a0).
