# OLVM Portal — API v1 / v2

API REST del portal. La autenticación es por API Key (`X-API-Key`) y **cada key hereda el rol de su dueño**, por lo que lo que puedes hacer vía API es exactamente lo que tu usuario puede hacer en el portal.

- Base URL: `https://TU-PORTAL/api/v1`
- Autenticación: header `X-API-Key: <key>`
- Content-Type: `application/json` (en operaciones de escritura)
- Documentación auto-descriptiva: `GET /api/v1` devuelve este índice con tus roles efectivos.

---

## Roles y permisos

| Rol | Lectura (GET) | Desplegar VM | Power actions | Clonar | Eliminar |
|---|---|---|---|---|---|
| `operator` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `user` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `superadmin` (global) | ✅ todos los tenants | ✅ | ✅ | ✅ | ✅ |

Reglas de aislamiento:

- **Fail-closed**: si tu key no tiene membership en el tenant → `403` sin revelar si existe.
- **Aislamiento por tag**: operar una VM de otro tenant (aunque conozcas el ID) → `403`.
- Los errores de permiso indican el rol requerido y tu rol actual.

---

## Gestión de API Keys

Desde el portal: **Perfil → API Keys** (cada usuario crea sus propias keys). Las keys se guardan hasheadas (SHA-256); si se pierde, se elimina y se crea otra. Una key desactivada deja de validar al instante.

---

## Endpoints

### Índice

```http
GET /api/v1
```
Devuelve la lista de endpoints, la matriz de roles y **tus roles efectivos** para esta key.

### Overview

```http
GET /api/v1/overview
```
Resumen de todos los tenants accesibles: VMs, CPU, RAM, storage.

### VMs (global)

```http
GET /api/v1/vms
```
Listado completo de VMs de tus tenants con recursos, status, métricas y tags.

### Storage

```http
GET /api/v1/storage
```
Uso de storage domains por tenant con porcentaje de uso.

### Tenant: detalle

```http
GET /api/v1/tenants/{tenantId}
```
Detalle de VMs y storage de un tenant.

### Tenant: catálogo para desplegar

```http
GET /api/v1/tenants/{tenantId}/catalog        # operator+
```
Clusters, plantillas, redes, vnic profiles y storage domains — todo lo necesario para construir el payload de un despliegue.

```bash
curl -H "X-API-Key: $KEY" \
  https://TU-PORTAL/api/v1/tenants/produccion/catalog | jq '.templates[] | {id, name}'
```

### Desplegar una VM

```http
POST /api/v1/tenants/{tenantId}/vms           # rol user+
```

Body:

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `name` | string | ✅ | Nombre de la VM |
| `clusterId` | string | ✅ | Ver `catalog` |
| `templateId` | string | ✅ | Ver `catalog` |
| `cpuCores` | number | — | Total vCPUs |
| `sockets` | number | — | Sockets virtuales |
| `memoryMB` | number | — | Memoria en MB |
| `vnicProfileId` | string | — | Red (ver `catalog`) |
| `os` | string | — | Tipo de OS |
| `comment` | string | — | Comentario |
| `cloudInit` | object | — | `{ ip, netmask, gateway, dns }` |

```bash
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"web-01","clusterId":"abc","templateId":"def","cpuCores":2,"memoryMB":2048}' \
  https://TU-PORTAL/api/v1/tenants/produccion/vms
```

Respuesta `201`:
```json
{ "ok": true, "deployed": { "tenantId": "produccion", "name": "web-01", "cpuCores": 2, "memoryMB": 2048 } }
```

La VM queda **apagada** con el tag del tenant aplicado (política multitenant).

### Operar una VM

```http
POST /api/v1/tenants/{tenantId}/vms/{vmId}/actions
```

| Action | Rol mínimo | Descripción |
|---|---|---|
| `start` | user | Enciende |
| `stop` | user | Apaga (hard) |
| `shutdown` | user | Apagado elegante |
| `reboot` | user | Reinicio |
| `run_once_cd` | user | Arranca una vez desde CD |
| `clone` | admin | Clona (requiere `cloneName`) |

```bash
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"action":"start"}' \
  https://TU-PORTAL/api/v1/tenants/produccion/vms/VM-ID/actions

# clonar
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"action":"clone","cloneName":"web-01-copy"}' \
  https://TU-PORTAL/api/v1/tenants/produccion/vms/VM-ID/actions
```

### Eliminar una VM

```http
DELETE /api/v1/tenants/{tenantId}/vms/{vmId}    # rol admin+
```
La VM se detiene y elimina con sus discos. **Irreversible.**

### Detalle de una VM

```http
GET /api/v1/tenants/{tenantId}/vms/{vmId}       # operator+
```

---

## Registro de actividad

Toda operación de escritura queda registrada en la tabla `Activity` con: tenant, VM, usuario, **origen (`portal` | `api`)**, acción, estado y timestamp. El registro nunca falla la operación principal.

### Consultar actividades

```http
GET /api/v1/activity                            # tus tenants (superadmin: todos)
GET /api/v1/tenants/{tenantId}/activity         # operator+ del tenant
```

```bash
curl -H "X-API-Key: $KEY" https://TU-PORTAL/api/v1/activity | jq '.activities[:3]'
```

Respuesta:
```json
{
  "total": 2,
  "activities": [
    { "userEmail": "dev@corp.com", "origin": "api", "action": "deploy",
      "vmName": "web-01", "status": "ok", "createdAt": "2026-08-21T12:00:00.000Z" },
    { "userEmail": "admin@corp.com", "origin": "portal", "action": "clone",
      "detail": "→ web-01-copy", "status": "ok", "createdAt": "2026-08-21T11:40:00.000Z" }
  ]
}
```

---

## Códigos de error

| Código | Significado |
|---|---|
| `401` | Falta `X-API-Key` o la key es inválida/desactivada |
| `403` | Tu rol no alcanza para la operación, o el tenant/VM no es tuyo |
| `400` | Body inválido (campos requeridos, action desconocida) |
| `404` | Recurso inexistente |
| `502` | Error comunicándose con el engine OLVM |

## Límites y buenas prácticas

- Las keys heredan el rol del usuario: crea keys por propósito (CI/CD = rol `user`; monitoreo = `operator`).
- Guarda la key en un secret manager; el portal solo guarda el hash.
- Los despliegues vía API aplican el mismo tag multitenant que el portal — no hay forma de escapar del aislamiento.
