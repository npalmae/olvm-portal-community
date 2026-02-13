# Diagrama de Arquitectura - OVM Portal

## Diagrama General del Sistema

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#3ad4ad', 'primaryTextColor': '#fff', 'primaryBorderColor': '#0b1321', 'lineColor': '#3ad4ad', 'secondaryColor': '#0b1321', 'tertiaryColor': '#1a2332'}}}%%

graph TB
    subgraph USUARIO["👤 Usuario"]
        BROWSER["🌐 Navegador Web"]
    end

    subgraph PORTAL["🚀 OVM Portal - Next.js 15"]
        direction TB
        
        subgraph AUTH["🔐 Autenticación"]
            LOGIN["/login"]
            REGISTER["/register"]
            NEXTAUTH["NextAuth.js v5"]
            USERSTORE["userStore.ts<br/>data/users.json"]
        end
        
        subgraph UI["🖥️ Interfaz"]
            DASHBOARD["Portal Principal<br/>Selección de Tenant"]
            CONSOLE_EMB["Consola Embebida<br/>noVNC"]
            CONSOLE_WEB["Consola Web<br/>Pestaña Nueva"]
        end
        
        subgraph API["⚙️ API Routes"]
            AUTH_API["/api/auth/*"]
            TENANT_API["/api/tenants/*"]
            PROXY_API["/api/console/proxy"]
            ADMIN_API["/api/admin/users"]
        end
        
        subgraph LIB["📚 Librerías"]
            OLVM_CLIENT["olvmClient.ts<br/>Cliente OLVM REST API"]
            WSPROXY["wsProxy.ts<br/>Proxy WebSocket Dinámico"]
            CONFIG["config.ts<br/>Configuración Tenants"]
        end
    end

    subgraph OLVM["☁️ OLVM Manager<br/>ocloudqa.sixmanager.cl"]
        direction TB
        
        subgraph DC["Data Center: ocloudqa"]
            CLUSTER["Cluster"]
            
            subgraph VMS["🖥️ Virtual Machines"]
                VM1["Lab-TESTVM1<br/>ID: f7c1f502-af25-41bd-bc59-d01d34e30768<br/>🏷️ Tag: tenant-a"]
                VM2["Lab-TESTVM1-tenant2<br/>ID: 49a5cd76-1575-47f6-8caf-4e9818b4575e<br/>🏷️ Tag: tenant-b<br/>💾 3GB RAM | 2 CPU"]
            end
            
            subgraph TAGS["🏷️ Tags"]
                TAG_A["tenant-a"]
                TAG_B["tenant-b"]
            end
        end
    end

    subgraph TENANTS["🏢 Tenants Configurados"]
        T_A["🟢 Tenant A<br/>Producción<br/>Tag: tenant-a"]
        T_B["🔵 Tenant B<br/>Desarrollo<br/>Tag: tenant-b"]
    end

    %% Conexiones principales
    BROWSER -->|"HTTP / HTTPS"| LOGIN
    BROWSER --> DASHBOARD
    BROWSER --> CONSOLE_WEB
    
    LOGIN --> NEXTAUTH
    REGISTER --> NEXTAUTH
    NEXTAUTH --> USERSTORE
    
    DASHBOARD --> TENANT_API
    CONSOLE_EMB --> PROXY_API
    CONSOLE_WEB -->|"abre"| CONSOLE_EMB
    
    TENANT_API --> OLVM_CLIENT
    PROXY_API --> WSPROXY
    OLVM_CLIENT --> CONFIG
    
    OLVM_CLIENT -->|"HTTPS + Basic Auth"| OLVM
    
    WSPROXY -->|"TCP Directo:5900"| VM1
    WSPROXY -->|"TCP Directo:5900"| VM2
    
    VM1 -.->|"tiene tag"| TAG_A
    VM2 -.->|"tiene tag"| TAG_B
    
    T_A -.->|"filtra por"| TAG_A
    T_B -.->|"filtra por"| TAG_B
    
    DASHBOARD -.->|"muestra VMs de"| T_A
    DASHBOARD -.->|"muestra VMs de"| T_B

    %% Estilos
    classDef portal fill:#0b1321,stroke:#3ad4ad,stroke-width:2px,color:#fff
    classDef olvm fill:#1a2332,stroke:#3ad4ad,stroke-width:2px,color:#fff
    classDef user fill:#2d3748,stroke:#fff,stroke-width:2px,color:#fff
    classDef tenant fill:#3ad4ad,stroke:#0b1321,stroke-width:2px,color:#000
    
    class PORTAL,API,LIB,AUTH,UI portal
    class OLVM,DC,CLUSTER,VMS,VM1,VM2,TAGS olvm
    class USUARIO,BROWSER user
    class TENANTS,T_A,T_B tenant
```

---

## Flujo de Autenticación

```mermaid
sequenceDiagram
    participant U as Usuario
    participant B as Navegador
    participant P as Portal
    participant A as Auth.js
    participant S as userStore.ts
    participant F as data/users.json

    U->>B: Ingresa a /login
    B->>P: POST /api/auth/callback/credentials
    P->>A: Validar credenciales
    A->>S: verifyUserCredentials()
    S->>F: Leer users.json
    F-->>S: Lista de usuarios
    S->>S: bcrypt.compare()
    S-->>A: Usuario válido
    A->>A: Generar JWT
    A-->>P: Token + Session
    P-->>B: Redirect a /
    B->>P: GET / con Cookie
    P-->>U: Portal con datos del tenant
```

---

## Flujo de Consola VNC

```mermaid
sequenceDiagram
    participant U as Usuario
    participant P as Portal
    participant I as /api/console/info
    participant X as /api/console/proxy
    participant W as wsProxy.ts
    participant O as OLVM
    participant V as VM

    U->>P: Click "Consola Embebida"
    P->>I: GET console/info?withTicket=1
    I->>O: fetchVmConsoleInfo()
    O-->>I: Ticket + Host + Port
    I->>X: ensureConsoleProxy()
    X->>W: Crear proxy WebSocket
    W-->>X: Puerto dinámico (ej: 40849)
    X-->>P: proxyWsUrl: ws://localhost:40849
    P->>W: Conectar WebSocket
    W->>V: TCP Directo puerto 5900
    V-->>W: Framebuffer VNC
    W-->>P: Datos binarios
    P-->>U: Pantalla noVNC
```

---

## Estructura de Tenants

```mermaid
graph LR
    subgraph USERS["👥 Usuarios"]
        SUPER["super@test.com<br/>SUPERADMIN<br/>🔑 Acceso a todos"]
        USER_A["user@a.com<br/>USER<br/>🔵 Tenant A"]
        USER_B["user@b.com<br/>USER<br/>🟢 Tenant B"]
    end

    subgraph PORTAL["🚀 OVM Portal"]
        SELECTOR["Selector de Tenant"]
    end

    subgraph TENANT_A["🏢 Tenant A"]
        VM_A1["Lab-TESTVM1<br/>Tag: tenant-a"]
    end

    subgraph TENANT_B["🏢 Tenant B"]
        VM_B1["Lab-TESTVM1-tenant2<br/>Tag: tenant-b"]
    end

    SUPER -->|"ve todos"| SELECTOR
    USER_A -->|"accede a"| SELECTOR
    USER_B -->|"accede a"| SELECTOR
    
    SELECTOR -->|"filtra"| TENANT_A
    SELECTOR -->|"filtra"| TENANT_B
    
    TENANT_A -.-> VM_A1
    TENANT_B -.-> VM_B1

    style SUPER fill:#f39c12,stroke:#d68910,color:#fff
    style USER_A fill:#3498db,stroke:#2980b9,color:#fff
    style USER_B fill:#27ae60,stroke:#229954,color:#fff
    style TENANT_A fill:#3498db,stroke:#2980b9,color:#fff
    style TENANT_B fill:#27ae60,stroke:#229954,color:#fff
```

---

## Stack Tecnológico

```mermaid
graph LR
    subgraph FRONTEND["🎨 Frontend"]
        NEXT["Next.js 15"]
        REACT["React 18"]
        TS["TypeScript"]
        TAILWIND["Tailwind CSS"]
    end

    subgraph AUTH["🔐 Auth"]
        AUTHJS["Auth.js v5"]
        JWT["JWT Session"]
        BCRYPT["bcryptjs"]
    end

    subgraph CONSOLE["🖥️ Consolas"]
        NOVNC["noVNC"]
        RFB["RFB Protocol"]
        PROXY["wsProxy.ts"]
    end

    subgraph BACKEND["⚙️ Backend API"]
        OLVM["OLVM Client"]
        REST["REST API"]
    end

    subgraph DATA["💾 Almacenamiento"]
        JSON["users.json"]
        ENV[".env.local"]
    end

    NEXT --> REACT
    REACT --> TS
    TS --> TAILWIND
    
    AUTHJS --> JWT
    AUTHJS --> BCRYPT
    BCRYPT --> JSON
    
    NOVNC --> RFB
    RFB --> PROXY
    PROXY --> OLVM
    
    OLVM --> REST
    REST --> ENV

    style NEXT fill:#000,stroke:#fff,color:#fff
    style REACT fill:#61dafb,stroke:#282c34,color:#000
    style AUTHJS fill:#3ad4ad,stroke:#0b1321,color:#000
```

---

## Mapa de Archivos

```mermaid
graph TD
    ROOT["ovm-portal/"] --> SRC["src/"]
    ROOT --> DATA["data/"]
    ROOT --> CONFIG[".env.local"]
    
    SRC --> APP["app/"]
    SRC --> LIB["lib/"]
    SRC --> AUTH["auth.ts"]
    SRC --> MIDDLE["middleware.ts"]
    
    APP --> API["api/"]
    APP --> LOGIN["login/page.tsx"]
    APP --> REGISTER["register/page.tsx"]
    APP --> HOME["page.tsx"]
    APP --> CONSOLE["console/page.tsx"]
    
    API --> AUTH_API["auth/[...nextauth]/"]
    API --> TENANT_API["tenants/[tenantId]/vms/"]
    API --> PROXY_API["console/proxy/"]
    API --> ADMIN_API["admin/users/"]
    
    LIB --> CONFIG_LIB["config.ts"]
    LIB --> OLVM["olvmClient.ts"]
    LIB --> USER["userStore.ts"]
    LIB --> WSPROXY["wsProxy.ts"]
    
    DATA --> USERS["users.json"]

    style ROOT fill:#0b1321,stroke:#3ad4ad,color:#fff
    style SRC fill:#1a2332,stroke:#3ad4ad,color:#fff
    style APP fill:#2d3748,stroke:#3ad4ad,color:#fff
    style LIB fill:#2d3748,stroke:#3ad4ad,color:#fff
```

---

## Estado del Proyecto

```mermaid
pie title Funcionalidad del Sistema
    "✅ Funciona" : 75
    "⚠️ Con Bugs" : 15
    "❌ No implementado" : 10
```

### ✅ Funciona (75%)
- Login/Registro con Auth.js
- Selección de Tenant
- Listado de VMs
- Acciones básicas (start/stop)
- Consola embebida (intermitente)

### ⚠️ Con Bugs (15%)
- Consola embebida: desconexiones
- Consola web: no muestra imagen
- Proxy WebSocket: puertos dinámicos

### ❌ No implementado (10%)
- Filtro real por tags en API
- Dashboard con métricas
- Logs de auditoría

---

## Datos de Acceso

| Recurso | URL | Credenciales |
|---------|-----|--------------|
| **Portal** | http://localhost:3000 | super@test.com / password123 |
| **OLVM** | https://ocloudqa.sixmanager.cl | admin@internal / sixman123 |

---

*Generado: 2026-02-12*  
*Versión: OVM Portal Multitenant v1.0*
