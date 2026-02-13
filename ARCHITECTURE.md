# Arquitectura OVM Portal

## Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                         USUARIO                                 │
│                   (Navegador Web)                               │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP/WebSocket
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OVM PORTAL                                   │
│              (Next.js 15 + React 18)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Login     │  │   Portal    │  │      Consolas           │  │
│  │  (Auth.js)  │  │   (VMs)     │  │   (noVNC embebida)      │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────────────┘  │
│                          │                                      │
│  ┌───────────────────────┼──────────────────────────────────┐  │
│  │                       ▼                                  │  │
│  │  Tenants Configurados:                                   │  │
│  │  ┌─────────────┐    ┌─────────────┐                     │  │
│  │  │ Tenant A    │    │ Tenant B    │                     │  │
│  │  │ (tenant-a)  │    │ (tenant-b)  │                     │  │
│  │  │ Tag:tenant-a│    │ Tag:tenant-b│                     │  │
│  │  └──────┬──────┘    └──────┬──────┘                     │  │
│  └─────────┼──────────────────┼─────────────────────────────┘  │
│            │                  │                                 │
└────────────┼──────────────────┼─────────────────────────────────┘
             │                  │ HTTPS (Basic Auth)
             └──────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OLVM MANAGER                                 │
│              https://ocloudqa.sixmanager.cl                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Data Center                          │   │
│  │                   (ocloudqa)                            │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │              Cluster                            │   │   │
│  │  │         (dcdcdd94-e038-...)                     │   │   │
│  │  │                                                 │   │   │
│  │  │  ┌──────────────────┐  ┌──────────────────┐   │   │   │
│  │  │  │ Lab-TESTVM1      │  │ Lab-TESTVM1      │   │   │   │
│  │  │  │ ID: f7c1f502...  │  │ -tenant2         │   │   │   │
│  │  │  │ Tag: tenant-a    │  │ ID: 49a5cd76...  │   │   │   │
│  │  │  │ Status: ?        │  │ Tag: tenant-b    │   │   │   │
│  │  │  │ RAM: ?           │  │ RAM: 3GB         │   │   │   │
│  │  │  │ CPU: ?           │  │ CPU: 2 cores     │   │   │   │
│  │  │  └──────────────────┘  └──────────────────┘   │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Flujo de Autenticación

```
Usuario
  │
  ▼
┌─────────────────┐
│  /login         │
│  (credentials)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  userStore.ts   │  ◄── data/users.json (bcrypt)
│  (JSON file)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  NextAuth.js    │  ◄── JWT session
│  (Auth.js v5)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Portal Home    │
│  + Tenant Select│
└─────────────────┘
```

## Flujo de Consola VNC

```
Usuario (Consola Embebida)
  │
  ▼
┌──────────────────────────┐
│  /api/console/proxy      │
│  POST (get ticket)       │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  wsProxy.ts              │  ◄── Puerto dinámico
│  (WebSocket proxy local) │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  TCP: vm-host:5900       │  ◄── VNC directo
└──────────────────────────┘
```

## Estructura de Archivos

```
ovm-portal/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/     ← Auth.js endpoints
│   │   │   ├── auth/register/          ← Registro de usuarios
│   │   │   ├── admin/users/            ← Admin API
│   │   │   ├── console/proxy/          ← WebSocket proxy API
│   │   │   └── tenants/[id]/vms/       ← VMs por tenant
│   │   ├── console/page.tsx            ← Página consola noVNC
│   │   ├── login/page.tsx              ← Login page
│   │   ├── register/page.tsx           ← Registro page
│   │   ├── page.tsx                    ← Portal principal
│   │   └── layout.tsx                  ← Root layout
│   ├── lib/
│   │   ├── config.ts                   ← Config tenants
│   │   ├── olvmClient.ts               ← Cliente OLVM API
│   │   ├── userStore.ts                ← Almacén usuarios
│   │   └── wsProxy.ts                  ← Proxy WebSocket
│   ├── auth.ts                         ← Config Auth.js
│   ├── auth-base.ts                    ← Config base (middleware)
│   └── middleware.ts                   ← Protección rutas
├── data/
│   └── users.json                      ← Usuarios (bcrypt)
├── .env.local                          ← Variables entorno
└── package.json
```

## Modelo de Datos

### Usuario (Portal)
```typescript
{
  id: string,
  email: string,
  password: string,      // bcrypt hashed
  name: string,
  tenantId: string,      // tenant asignado
  role: "user" | "admin" | "superadmin",
  createdAt: string
}
```

### Tenant Config
```typescript
{
  id: string,            // "tenant-a" | "tenant-b"
  name: string,          // "Tenant A - Producción"
  baseUrl: string,       // URL OLVM API
  username: string,      // admin@internal
  password: string,      // credencial OLVM
  allowInsecure: boolean,
  tag?: string           // "tenant-a" | "tenant-b"
}
```

### VM (OLVM)
```typescript
{
  id: string,
  name: string,
  status: "up" | "down" | ...,
  cluster: string,
  host: string,
  memoryMB: number,
  cpuCores: number,
  tags: string[]         // ["tenant-a"] | ["tenant-b"]
}
```

## Seguridad

| Capa | Implementación |
|------|---------------|
| Auth | NextAuth.js v5 (Auth.js) + JWT |
| Passwords | bcryptjs (10 rounds) |
| Session | JWT con tenantId y role |
| HTTPS | allowInsecure para cert autofirmado |
| CORS | Proxy WebSocket local (wsProxy.ts) |

## Multi-Tenancy Actual

```
┌────────────────────────────────────┐
│           Usuario                  │
│    super@test.com (superadmin)     │
└──────────────┬─────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌──────────────┐    ┌──────────────┐
│  Tenant A    │    │  Tenant B    │
│  Producción  │    │  Desarrollo  │
└──────┬───────┘    └──────┬───────┘
       │                   │
       ▼                   ▼
┌──────────────┐    ┌──────────────┐
│ Lab-TESTVM1  │    │ Lab-TESTVM1  │
│ (tenant-a)   │    │ -tenant2     │
│ tag:tenant-a │    │ (tenant-b)   │
└──────────────┘    │ tag:tenant-b │
                    └──────────────┘
```

## Próximos Pasos Sugeridos

1. **Filtrado real por tags**: Modificar API para filtrar VMs según tag del tenant
2. **Consola web funcional**: Arreglar la consola en pestaña nueva
3. **Gestión de usuarios**: Página admin para crear/editar usuarios
4. **Métricas**: Dashboard con estadísticas de uso
5. **Logs**: Auditar acciones de usuarios

---

*Documento generado el 2026-02-12*
*Proyecto: OVM Portal Multitenant*
