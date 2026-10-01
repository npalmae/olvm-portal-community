# Changelog

Todas las versiones notables del portal se documentan aquí.
El formato sigue [SemVer](https://semver.org): `vMAJOR.MINOR.PATCH`.

## [1.3.0] — pendiente de release
- feat: tema oscuro — toggle auto/claro/oscuro persistido, paleta completa vía tokens y utilidades remapeadas, sin destello inicial
- feat: módulo de versiones (F1) — `GET /api/system/version`, badge en sidebar, changelog integrado en `/admin/system`
- feat: detección de actualizaciones (F2) — chequeo contra GitHub Releases con banner para administradores y guía de actualización manual

## [1.2.3] — pendiente de release
- fix(ui): tablas de administración responsivas — los botones de acciones ya no se cortan en ventanas angostas (/admin/users, /admin/clusters)
- ui: selector de idioma con chips de código (ES/EN/DE/PT) en reemplazo de banderas emoji
- feat: módulo de versión — `GET /api/system/version`, badge de versión y changelog integrado (roadmap F1)

## [1.2.2] — 2026-09-22
- ui: sidebar colapsable tipo rail (56px) con hover-peek overlay animado y preferencia persistida
- fix: se retira `upgrade-insecure-requests` del CSP (rompía estilos en despliegues HTTP/staging)

## [1.2.1] — 2026-09-07
- security: proxy de consola endurecido — sesiones opacas de un solo uso, sin targets/tickets en URLs
- security: headers del navegador (CSP, nosniff, frame-options, permissions-policy), setup atómico, tenant-admin acotado a su tenant

## [1.2.0] — 2026-09-05
- Edición pública inicial saneada (community): instalador `install.sh`, documentación y ejemplos

## [1.0.0]
- Portal multitenant para OLVM/oVirt: VMs, consola noVNC, OVA/ISO, usuarios/roles, API v1 con keys
