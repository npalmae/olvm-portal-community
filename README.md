# olvm-portal
Portal de administración multitenant para OLVM/oVirt construido con Next.js.

## En esta sesión (2026-02-10 10:00 -03)
- Plan: generar y validar cuentas de login para acceso al portal (alta de credenciales y pruebas rápidas).
- Consola embebida: fuerza `fbUpdateRequest` al conectar y reintenta si no llegan FBU; ahora es interactiva (mouse/teclado) y registra eventos `fbupdate`, `desktopname`, etc.
- Proxy WS local: logs extendidos (hasta 50 mensajes) para depurar RFB, `perMessageDeflate` desactivado y fallback automático de puerto cuando 3010 está ocupado.
- Mantén el host del engine igual al CN del cert (`ocloudqa.sixmanager.cl`) y asegúrate de salida TCP al puerto VNC (`port`/`tlsPort`).
- 2026-01-20 12:36 -03: Se restauró el estado local desde `origin/main`; se conservan backups `ovm-portal-backup-*.tar.gz` sin versionar.

## Ejecutar en local

```bash
npm install
npm run dev
# abrir http://localhost:3000
```

Configura los tenants OLVM en `.env.local` siguiendo el ejemplo de `.env.example`.

### Configuración de tenants
- Usa `OLVM_TENANTS` como arreglo JSON; si solo hay un tenant puedes usar las variables `OLVM_BASE_URL/USERNAME/PASSWORD` como fallback.
- Reinicia `npm run dev` si modificas `.env.local`; de lo contrario el servidor puede no ver los cambios y verás errores tipo `Tenant undefined not found`.
- Si hay un único tenant configurado, las rutas API lo usarán como fallback cuando el `tenantId` llegue vacío; con múltiples tenants el `tenantId` es obligatorio.
- Si exportas las variables con `source .env.local`, envuelve `OLVM_TENANTS` en comillas simples (`OLVM_TENANTS='[{"id":"..."}]'`) para conservar el JSON válido.
- Errores de conexión a OLVM se muestran como `No se pudo conectar con OLVM (<baseUrl>): ...`; revisa URL, CA y conectividad si aparecen mensajes tipo `fetch failed`.
- Usa en `baseUrl` el hostname que coincide con el certificado del engine (no la IP) para evitar fallos SAN.

### Estructura multitenant por tags
Diseño acordado para aislamiento real por tenant:

1. Modelo canónico
- Cada tenant en `OLVM_TENANTS` debe tener `id` y `tag` únicos (ej: `tenant-a`, `tenant-b`).
- Cada VM visible/operable por un tenant debe portar su `tag` en OLVM.

2. Regla de autorización
- Usuarios no `superadmin` solo pueden operar VMs de su `tenantId` y con el `tag` del tenant.
- La validación se hace en backend antes de `start/stop/reboot/clone/update/console`.

3. Alcance funcional
- Listado de VMs: filtrar por `tag` del tenant.
- Crear/clonar VM: aplicar automáticamente `tag` del tenant al recurso nuevo.
- Auditoría: detectar VMs sin `tag` o con `tag` cruzado.

4. Orden de implementación
- Paso 1: enforcement de backend por `tag` (bloqueos por política).
- Paso 2: filtrado por `tag` en listados.
- Paso 3: auto-tag en create/clone.
- Paso 4: endpoint/tarea de auditoría de inconsistencias.

### Consola embebida / noVNC
- La API `/api/console/proxy` intenta primero websockify (si existe) y luego puentea por TCP directo al host/puerto VNC entregado por OLVM.
- Asegúrate de que desde tu máquina haya salida TCP hacia el host/puerto VNC (`tlsPort`/`port` de la VM); si el puerto está cerrado verás errores 1006/1011.
- Activa “Usar proxy WS local” en la UI para que el proxy interno gestione certificados y fallback.

## Scripts de verificación

```bash
npm run lint   # linting con ESLint
npm test       # pruebas unitarias (Vitest)
```

## Historial de cambios
- Última actualización: 2026-02-10 10:00 -03
- 6b7213e – Fix embedded console: request framebuffer and improve ws proxy logging
- 7c5b01d – fix: add memory.used.percent lookup for memory metrics
- dc0c3de – fix: include statistics in VM requests and broaden metric lookups
- 000d73c – ui: sanitize HTML responses in client error parsing
- d665003 – fix: remove duplicate action history state causing build error
- de4c5fc – ui: log resource updates and VM creations in recent actions
- d5ce385 – fix: improve CPU topology calc and metric lookups
- 09aa1ff – ui: add action log, auto-dismiss alerts, and visible usage bars
- 8a8bcac – ui: make usage bars visible even without metrics
- f68f16b – ui: add usage bars to VM metrics cards
- 34feae9 – docs: update last update date in history
- 0405b82 – Fix: await params promise en rutas API dinámicas (acciones/VMs)
- 228ae3d – Fix: parse API respuestas no-JSON en el cliente y serializar tests OLVM
- 63e7bc4 – Fix: fuerza formato JSON y usa undici dispatcher para TLS/CA
- 26d460e – Add operational notes and update README
- bc42acc – Improve OLVM error handling and add tests
- 2dd1a4b – fix: avoid OLVM Filter header to show all VMs
- d965ec8 – fix: guard invalid tenant selection
- ac03436 – docs: add ownership signature to readme
- d10e9f3 – chore: initial commit
- c937203 – Initial commit
- Revisa `CHANGELOG.md` para ver y actualizar este registro cuando se sincronicen commits nuevos desde GitHub.

---

Propietario: Nicolás Palma
