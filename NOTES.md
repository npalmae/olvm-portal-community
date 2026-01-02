# Notas operativas

## Contexto rápido
- App Next.js 16 (App Router) que consume la API de OLVM/oVirt.
- Configuración por `.env.local` usando `OLVM_TENANTS` (JSON) o fallback `OLVM_BASE_URL/USERNAME/PASSWORD`; `allowInsecure` y `caFile` soportados.
- Cliente OLVM (`src/lib/olvmClient.ts`) maneja Basic/Bearer, CA opcional y errores de conexión con mensaje: `No se pudo conectar con OLVM (<baseUrl>): ...`.
- UI principal en `src/app/page.tsx`; rutas API en `src/app/api/tenants/...`.

## Scripts útiles
- `npm run dev` – entorno de desarrollo.
- `npm run lint` – ESLint.
- `npm test` – Vitest (pruebas en `tests/`).

## Últimos cambios clave
- Validaciones de payloads en rutas API y mensajes de error más descriptivos.
- Exposición de acciones soportadas en el cliente OLVM.
- Pruebas unitarias para `config` y `olvmClient`.
- README actualizado con scripts y notas de conexión.

## Próximos pasos sugeridos
- Propagar mensajes de error detallados hasta la UI (mostrar baseUrl/causas).
- Añadir pruebas de integración de API (mocks de fetch) y cobertura de multitenant.
- Revisar manejo de timeouts y reintentos hacia OLVM si hay latencia.
