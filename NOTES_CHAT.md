# Chat log – consola web OLVM (2026-01-15)

Resumen breve de la sesión enfocada en la consola web/noVNC:

- Problema inicial: error noVNC `Connection closed (1006)` o `No upstream target available`.
- Se detectó que los endpoints WS del engine devolvían 404/ECONNRESET en `/ovirt-engine/websockify`/`websocket` (puertos 443/6100/6101).
- Se propusieron pasos en el engine:
  - Instalar/activar `ovirt-websocket-proxy`, abrir puertos 6100/6101.
  - Publicar ProxyPass WS en Apache: `/ovirt-engine/websocket` y `/ovirt-engine/websockify` (y variantes sin `/ovirt-engine`) hacia `ws://127.0.0.1:6100/`, con headers `Connection/Upgrade`.
  - Verificar con `curl -i -k "https://ocloudqa.sixmanager.cl/ovirt-engine/websocket?ticket=<ticket>"` que responda 101, y probar directo al backend `http://127.0.0.1:6100/websocket?ticket=<ticket>`.
- Aún tras habilitar, las pruebas con ticket fresco (`7jgAfQSd`) siguen dando 404 en 443, `ECONNRESET` en 6100, `ECONNREFUSED` en 6101 → falta ajustar servicio o ProxyPass.
- Recordatorio: el `<ticket>` debe venir de OLVM (`/graphicsconsoles/{id}/ticket` o `GET /api/.../console/info` en el portal); caduca en ~2 minutos.
