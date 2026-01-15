# olvm-portal
Portal de administración multitenant para OLVM/oVirt construido con Next.js.

## En esta sesión (2026-01-14 21:10 -03)
- Consola embebida noVNC con rutas websockify múltiples y manejo de certificados self-signed; acciones de VM y métricas visibles.

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

## Scripts de verificación

```bash
npm run lint   # linting con ESLint
npm test       # pruebas unitarias (Vitest)
```

## Historial de cambios
- Última actualización: 2026-01-12 10:31 -03
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
