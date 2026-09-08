# VIRTUAL-PORTAL — Arquitectura de la edición VMware vSphere

> Derivado del portal OLVM (mismo código base, fork `virtual-portal`).
> Estado: **Fase 0 completada** (seam de engine + cliente VMware núcleo con
> soporte 7.x/8.x/9.x). Pendiente: validación contra vCenter real del
> laboratorio (marcada `TODO(lab)`).

## 0. Soporte multi-versión (7.x / 8.x / 9.x)

vSphere 9 (VCF 9) **elimina los endpoints legacy `/rest` (vAPI JSON-RPC)**;
7.x/8.x exponen REST moderno (`/api`) solo parcialmente. El cliente resuelve
esto con una **matriz de capacidades**:

- `getVcenterVersion()` detecta la versión al conectar (`/api/appliance/system/version`, cacheada por engine).
- Cada operación (`vm.create`, `vm.clone`, `vm.cpu.update`, `vm.memory.update`, …) declara **candidatos**: endpoint REST moderno (`/api`, único camino en 9.x) + servicio vAPI (`/rest`, 7/8).
- `runCapability()` ejecuta el primer candidato soportado por la versión detectada y **cachea la resolución** por engine+capacidad (sin re-probar).
- Endpoints estables en las tres versiones (sin candidatos): sesión, tagging `cis`, vcenter/vms, power, cluster/host/datastore/network, console tickets, Content Library.

| Operación | 7.x / 8.x | 9.x |
|---|---|---|
| Sesión `/api/session` (Basic) | ✅ | ✅ (opcional: API tokens de servicio) |
| Tagging `/api/cis/tagging/*` | ✅ | ✅ |
| VMs / power / delete | ✅ | ✅ |
| Console tickets (WEBMKS) | ✅ (7.0U2+) | ✅ |
| **Create / Clone / CPU / RAM** | vAPI `/rest` | REST `/api` (shapes `TODO(lab)`) |
| Content Library (ISO/OVF/templates) | ✅ | ✅ |
| vAPI `/rest` | ✅ (deprecated en 8) | ❌ **removido** |

## 1. Principio rector

El aislamiento multi-tenant **lo enforce el portal, no el hypervisor**. vCenter
ve una única cuenta de servicio; los usuarios finales jamás existen en vCenter.
Este es el mismo modelo validado en producción con OLVM desde 2026.

```
┌────────────────────────────────────────────────────────────┐
│                    VIRTUAL-PORTAL (Next.js)                │
│                                                            │
│  UI (dashboard/consola) → Rutas API → RBAC por membership  │
│                                        │                   │
│                          ┌─────────────┴────────────┐      │
│                          │   src/lib/engineClient   │      │
│                          │   (dispatcher por tipo)  │      │
│                          └───────┬──────────┬───────┘      │
│                      type=olvm   │          │  type=vmware │
│                          ┌───────┴───┐  ┌───┴──────────┐   │
│                          │olvmClient │  │ vmwareClient │   │
│                          └───────┬───┘  └───┬──────────┘   │
└──────────────────────────────────┼──────────┼──────────────┘
                        oVirt REST │          │ vCenter REST
                        ┌──────────┴──┐  ┌────┴─────────┐
                        │  OLVM engine│  │  vCenter 7/8 │
                        └─────────────┘  └──────────────┘
```

## 2. Capas y qué se reutiliza

| Capa | Reutilización | Notas |
|---|---|---|
| Auth (NextAuth + 2FA Resend) | 100% | Sin cambios |
| Usuarios/roles/memberships | 100% | superadmin/admin/user/operator |
| Multi-tenant por **tag único** | 100% (concepto) | vSphere Tagging API en categoría dedicada `virtual-portal-tenant` |
| Jobs/operaciones visibles por tenant | 100% | OperationJob/CloneJob intactos |
| API keys `/api/v1/*` | 100% | |
| Proxy de consola (sesiones opacas + wsProxy) | 100% | wsProxy ya soporta `wss://` upstream (WebMKS) |
| UI completa (dashboard, sidebar rail, wizards) | ~95% | Textos "storage domain" → "datastore", etc. |
| Cliente del engine | **reescrito** | `vmwareClient.ts` (nuevo) tras el seam |

## 3. Modelo de tenancy (vSphere)

- **Categoría**: `virtual-portal-tenant` (MULTIPLE, asociable solo a VirtualMachine).
- **Tag por tenant**: nombre = `tenant.tag` (único por engine, igual que OLVM).
- **Flujo**:
  - Listar VMs del tenant = `tag-association list-attached-objects` ∩ `GET /api/vcenter/vms`.
  - Toda mutación pasa por `enforceVmTagPolicy` (fail-closed: sin tag configurado → 403).
  - VM nueva/clonada → `applyTenantTag` post-creación (idempotente).
- **Por qué no folders**: una VM vive en un solo folder y los folders son por
  datacenter; tags cruzan datacenters/clusters y portan 1:1 el diseño actual.
- **Por qué no VCD/permissions**: el portal es el único plano de control;
  VCD duplicaría (con licencia aparte) lo que el portal ya hace.

## 4. Mapeo de APIs (implementado en `vmwareClient.ts`)

| Portal (concepto) | OLVM | VMware (vCenter REST) | Estado |
|---|---|---|---|
| Login/sesión | SSO Bearer | `POST /api/session` → `vmware-api-session-id` (cache 25min + re-login on 401) | ✅ |
| Tags de tenant | `/tags` | `/api/cis/tagging/*` (categoría, tags, asociación) | ✅ |
| Lista VMs por tenant | `/vms?search=tag` | tagging ∩ `/api/vcenter/vms` | ✅ |
| Power actions | `/vms/{id}/{action}` | `/api/vcenter/vm/{vm}/power/*` + guest shutdown con fallback | ✅ |
| Borrar VM | stop + DELETE | power/stop + `DELETE /api/vcenter/vm/{vm}` | ✅ |
| Clone | `/vms/{id}/clone` | vAPI `vcenter.vm.clone` + tag + stop (mismo flujo OLVM) | ✅ |
| Crear VM | `/vms` POST | vAPI `vcenter.VM.create` (placement/cpu/memory) | ✅ |
| CPU/RAM update | PUT `/vms/{id}` | vAPI `hardware.cpu/memory.update` | ✅ |
| Clusters/Hosts | `/clusters`, `/hosts` | `/api/vcenter/cluster`, `/host` | ✅ |
| Datastores | `/storagedomains` | `/api/vcenter/datastore` (mismo filtro por nombres del tenant) | ✅ |
| Redes / "vnic profiles" | `/networks`, `/vnicprofiles` | `/api/vcenter/network` (VMware no tiene perfiles; la red ES el perfil) | ✅ |
| Consola | ticket VNC + noVNC | `POST /api/vcenter/vm/{vm}/console/tickets` (WEBMKS `wss://`) | ✅ código / ⏳ validar forma del ticket |
| Templates | `/templates` | Content Library (OVF/vVMTX) | ⏳ Fase 2 |
| Discos/NICs/CDROM | image transfers, attachments | vAPI `hardware.disk/ethernet/cdrom` | ⏳ Fase 2 |
| ISO/OVA upload | image transfer + SCP + qemu-img | Content Library (upload session + OVF deploy) — **sin qemu-img/SCP** | ⏳ Fase 2 |
| Métricas (%) | statistics | vAPI vstats / perfmanager | ⏳ Fase 2 |

## 5. Consola: por qué funciona el proxy actual

El proxy de consola (hardened: sesiones opacas de un solo uso, `127.0.0.1`,
targets solo en memoria) acepta upstreams `ws://`, `wss://`, `tcp://`, `tls://`.
El ticket WebMKS de vCenter ES una URL `wss://vcenter:7343/ticket/...`:
se entrega como target de la sesión → noVNC se reemplaza por el cliente
WebMKS (`vmware-webmks` ESModule o similar) en `/console` (adaptación menor).

## 6. Cambios de esquema

```sql
ALTER TABLE "Engine" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'olvm';
```

- `Engine.type = "olvm" | "vmware"` — los engines existentes quedan `olvm`.
- `TenantConfig.engineType` despacha en `engineClient.ts`.
- Alta de engine vCenter: mismo formulario (baseUrl + usuario/password + CA),
  seleccionando tipo "vmware". `sharedStorageDomains` = nombres de datastores.

## 7. Fases

| Fase | Alcance | Criterio de salida |
|---|---|---|
| **0. Seam + cliente núcleo** (este commit) | engineClient, vmwareClient (login/tags/VMs/power/clone/inventario/consola-ticket), schema | tsc + 80/80 tests |
| **1. Validación lab** | Conectar vCenter real: sesión, tags, listado, power, clone, ticket WebMKS vía proxy | Script e2e contra lab en verde |
| **2. Hardware + despliegue** | discos/NICs/CDROM vAPI, Content Library (ISO/OVA/templates), `/console` con WebMKS | Wizard VM completo + ISO mount + OVA deploy |
| **3. Migración de rutas** | sed `olvmClient` → `engineClient` en rutas; textos UI datastore/red | UI 100% agnóstica |
| **4. Endurecimiento** | Métricas, cuotas por resource pool, cache de listado VMs, rate limits | Paridad funcional con OLVM |

## 8. Seguridad (heredada + específica)

- Heredado del hardening 2026-08: sesiones de consola opacas, CSP, setup
  atómico, tenant-admin acotado, no-store en endpoints sensibles.
- VMware: la cuenta de servicio vCenter con **rol mínimo** (solo el cluster/vDC
  del portal): VM config, tagging, Content Library, sessions. Nunca admin global.
- `allowInsecure`/`caCert` por engine — mismo plumbing TLS (undici dispatcher
  por tenant) que OLVM; para vCenter productivo exigir CA real.
- Credenciales del engine cifradas en BD (FIELD_ENCRYPTION_KEY), igual que hoy.
