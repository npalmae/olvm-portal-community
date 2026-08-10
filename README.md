<p align="center">
  <img src="docs/olvm-logo.svg" alt="OLVM Portal" width="300">
</p>

# 🖥️ OLVM Portal

**Plataforma de administración multitenant para OLVM / oVirt**

Portal web self-service que permite gestionar máquinas virtuales, storage domains, ISOs y usuarios sobre motores OLVM/oVirt, con aislamiento por tenant y control de acceso basado en roles.

---

## 📸 Capturas

| Vista | Imagen |
|-------|--------|
| Login + 2FA | ![Login](docs/portal-login.png) |
| Dashboard | ![Dashboard](docs/portal-dashboard.jpg) |
| Gestión de VMs | ![VMs](docs/portal-vm-panel.png) |
| Admin Tenants | ![Admin](docs/portal-admin.jpg) |
| Admin Usuarios | ![Users](docs/portal-users.jpg) |

## ✨ Características

### 📊 Dashboard Inteligente
- Métricas en tiempo real: CPU, RAM y almacenamiento por tenant
- Vista global "Todos los tenants" con tarjetas resumidas
- Donut charts y barras de uso por storage domain

### 🖥️ Gestión de VMs
- **Crear VMs** con selector de OS (Linux/Windows) que ajusta el hardware automáticamente
- **Ciclo de vida completo**: start, stop, shutdown, reboot, clonar, eliminar
- **Discos**: crear con interfaz VirtIO/SATA/IDE, eliminar, ver detalles
- **Recursos**: editar RAM y vCPU en caliente
- **Consola**: VNC embebida en el navegador + descarga de archivo `.vv`

### 💿 Storage Domains
- Asignación de SDs por tenant (filtrado de visibilidad)
- **SDs compartidos** por engine (ej: repositorio de ISOs visible para todos)
- Métricas correctas de espacio (available / used / total)

### 📀 Gestión de ISOs
- **Subir ISOs** al storage domain desde el portal (hasta 10GB, upload por chunks con barra de progreso)
- Montar/desmontar ISO en VMs (CD-ROM)
- Listado automático con refresh al abrir el dropdown
- Validación anti-duplicados

### 🔐 Instalación de Sistemas Operativos
- Flujo completo: crear VM → agregar disco → montar ISO → **encender desde CD** → instalar via consola
- Selector de OS define la interfaz de disco óptima (SATA para Windows, VirtIO para Linux)

### 👥 Multitenant & Seguridad
- **Engines separados de Tenants**: un engine sirve a N tenants sin duplicar credenciales
- **Tags de OLVM** para filtrado automático de VMs por tenant
- **Roles**: superadmin (global), admin/user (por tenant)
- **Memberships multi-tenant**: un usuario puede pertenecer a varios tenants
- **2FA** obligatorio vía email (Resend)
- Middleware que bloquea acceso cross-tenant

### ⚙️ Administración
- CRUD de Engines (URL, credenciales, CA cert, test de conexión, SDs compartidos)
- CRUD de Tenants (engine, tag, storage domains asignados)
- CRUD de Usuarios (memberships, 2FA, default tenant, reset password)

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Framework** | Next.js 15 (App Router, SSR) |
| **Lenguaje** | TypeScript |
| **UI** | React 19, Tailwind CSS |
| **Auth** | NextAuth.js (JWT + 2FA) |
| **2FA** | Resend (email OTP) |
| **Virtualización** | noVNC (consola embebida) |
| **API OLVM** | oVirt REST API v4 |
| **Runtime** | Node.js 22 |
| **Deploy** | Docker (standalone) |

---

## 🏗️ Arquitectura

```
┌──────────────────────────────────────────────────┐
│                   Browser (Cliente)                │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │ Dashboard │  │ VM Panel │  │ Consola noVNC   │  │
│  └─────┬─────┘  └─────┬────┘  └────────┬────────┘  │
└────────┼──────────────┼───────────────┼───────────┘
         │              │               │
┌────────▼──────────────▼───────────────▼───────────┐
│              Next.js 15 (Server)                    │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │ API Routes│  │ Auth/JWT │  │ WS Proxy (3010) │  │
│  └─────┬─────┘  └──────────┘  └─────────────────┘  │
│  ┌─────▼─────────────────────────────────────────┐ │
│  │  engineStore / clusterStore / userStore       │ │
│  │  (JSON file-based, seeding desde env vars)     │ │
│  └─────┬─────────────────────────────────────────┘ │
└────────┼────────────────────────────────────────────┘
         │
┌────────▼───────────────────────────────────────────┐
│            OLVM / oVirt Engine (REST API)           │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │   VMs   │  │ Storage  │  │ Image Transfer   │   │
│  │ Disks   │  │ Domains  │  │ (ISO upload)     │   │
│  │ Tags    │  │ ISOs     │  │                  │   │
│  └─────────┘  └──────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Instalación

### Instalación rápida (recomendada)

El portal incluye un script interactivo (`install.sh`) que verifica prerequisitos, genera los secretos de bootstrap, construye los contenedores y abre un wizard web para la configuración inicial.

```bash
git clone https://github.com/npalmae/olvm-portal.git
cd olvm-portal
chmod +x install.sh
./install.sh
```

El script verifica automáticamente:
- ✅ Docker instalado (lo instala automáticamente si no está, en Debian/Ubuntu/CentOS/Fedora)
- ✅ Docker Compose (v1 o v2)
- ✅ OpenSSL (para generar secretos)
- ✅ Puerto 3000 libre
- ✅ Espacio en disco (mín. 5 GB)
- ✅ RAM (mín. 2 GB recomendado)

Después genera el `.env` con secretos aleatorios (`AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`, `DB_PASSWORD`), construye y levanta los contenedores, e imprime la URL del wizard:

```
http://<servidor>:3000/setup
```

### Wizard web de configuración (/setup)

Al abrir el navegador por primera vez, aparece el wizard interactivo:

| Paso | Descripción | Obligatorio |
|------|-------------|:-----------:|
| 1. **Superadmin** | Crear el primer usuario administrador global (email + password) | ✅ |
| 2. **Motor OLVM** | URL del engine, usuario y password. Botón "Probar conexión" | ✅ |
| 3. **Tenant** | Nombre del tenant + tag OLVM (se crea automáticamente en el engine) | ✅ |
| 4. **Email** | API key de Resend + email remitente (para 2FA y notificaciones) | ⏭ Opcional |
| 5. **SSH Hosts** | Usuario y password SSH de los hosts OLVM (para import OVA/qcow2) | ⏭ Opcional |
| 6. **Listo** | Redirección al dashboard | — |

El wizard crea el superadmin sin autenticación (solo funciona si no existe uno previo), se autologuea, y los pasos siguientes usan los endpoints admin autenticados.

### Datos que necesitas tener a mano

- URL de la API REST del motor OLVM/oVirt (ej: `https://engine.example.com/ovirt-engine/api`)
- Credenciales del engine (usuario + password, típicamente `admin@internal`)
- Nombre y tag del tenant (ej: `produccion`)
- *(Opcional)* API key de Resend + email remitente para 2FA
- *(Opcional)* Credenciales SSH de los hosts OLVM (`root` + password)

### Despliegue manual (sin install.sh)

Si preferís configurar todo a mano:

```bash
git clone https://github.com/npalmae/olvm-portal.git
cd olvm-portal

# 1. Crear .env con los secretos mínimos
cp .env.example .env
# Editar AUTH_SECRET, FIELD_ENCRYPTION_KEY, DB_PASSWORD, AUTH_URL
# Generar secretos con: openssl rand -base64 32

# 2. Construir y levantar (usar docker compose v2 o docker-compose v1)
docker compose up -d --build
# o: docker-compose up -d --build

# 3. Abrir el wizard
# http://<servidor>:3000/setup
```

### Instalación en un servidor nuevo (paso a paso)

```bash
# 1. Clonar el repositorio
git clone https://github.com/npalmae/olvm-portal.git
cd olvm-portal

# 2. Ejecutar el instalador
chmod +x install.sh
./install.sh
# → Verifica prerequisitos
# → Instala Docker si falta
# → Genera .env con secretos aleatorios
# → Pregunta la URL pública del portal
# → Construye y levanta los contenedores

# 3. Abrir el navegador en la URL que muestra el script
# http://<IP>:3000/setup

# 4. Completar el wizard web (superadmin → engine → tenant → email → SSH)

# 5. ¡Listo! El portal redirige al dashboard
```

### Gestión de contenedores

```bash
# Ver estado
docker-compose ps

# Ver logs
docker logs -f olvm-portal

# Reiniciar
docker-compose restart portal

# Detener
docker-compose down

# Actualizar (nueva versión del código)
git pull origin main
docker-compose build portal
docker stop olvm-portal && docker rm olvm-portal
docker-compose up -d portal
```

---

## ⚙️ Variables de Entorno

El script `install.sh` genera automáticamente las variables de bootstrap. El resto se configura desde el wizard web o el panel de administración.

### Generadas por install.sh (bootstrap)

| Variable | Descripción |
|----------|-------------|
| `AUTH_SECRET` | Secreto para JWT (aleatorio) |
| `FIELD_ENCRYPTION_KEY` | Clave AES-256-GCM para cifrar credenciales en DB (aleatorio) |
| `DB_PASSWORD` | Password de PostgreSQL (aleatorio) |
| `AUTH_URL` / `NEXTAUTH_URL` | URL pública del portal (se pregunta en la instalación) |
| `AUTH_TRUST_HOST` | Confiar en el host detrás de proxy (`true`) |
| `REQUIRE_2FA` | Forzar 2FA (`false` durante setup, activar desde el panel) |

### Configurables desde el wizard web (/setup) o el panel admin

| Variable | Dónde se guarda | Descripción |
|----------|----------------|-------------|
| Engine OLVM (URL, user, pass) | PostgreSQL (cifrado) | Configuración del motor OLVM |
| Tenant + tag | PostgreSQL | Aislamiento multitenant |
| Email (Resend) | PostgreSQL (cifrado) | API key + email remitente para 2FA |
| SSH Hosts OLVM | PostgreSQL (cifrado) | Credenciales SSH para import OVA/qcow2 |

### Importación OVA/qcow2

| Variable | Descripción |
|----------|-------------|
| `OVA_STAGING_DIR` | Directorio del portal donde se guardan los archivos subidos |
| `OVA_HOST_STAGING_DIR` | Directorio temporal en el host OLVM para SCP (se crea automáticamente con `mkdir -p`) |

Se aceptan archivos `.ova` (con disco VMDK o qcow2 dentro) y `.qcow2` directos.

---

## 📖 Flujo de Trabajo

### Crear VM e instalar OS
```
1. Seleccionar tenant → tab "Nuevo"
2. Elegir OS (Linux/Windows), cluster, RAM, vCPU
3. Crear VM
4. Seleccionar VM → tab "Acciones"
5. Agregar disco (seleccionar interfaz según OS)
6. Montar ISO desde el dropdown
7. "Encender desde CD" (Run Once)
8. Abrir consola VNC → instalar OS
9. Apagar → encender normal
```

### Subir ISO al repositorio
```
1. Tab "Acciones" → sección ISO / CD-ROM
2. Click "↑ Subir ISO al storage domain"
3. Seleccionar archivo .iso
4. Barra de progreso muestra avance (upload por chunks de 50MB)
5. "Procesando en OLVM..." → Toast verde al completar
```

---

## 👤 Usuario Inicial

El primer usuario **superadmin** se crea desde el wizard web (`/setup`) durante la instalación. No hay usuarios seed predefinidos. Los usuarios adicionales se crean desde el panel de administración (`/admin/users`).

---

## 🔒 Seguridad

- **PostgreSQL + Prisma**: todos los datos operativos viven en PostgreSQL (no en archivos JSON planos)
- **Cifrado AES-256-GCM**: credenciales del engine, API keys y secretos del sistema se cifran en la DB con `FIELD_ENCRYPTION_KEY`
- **JWT stateless**: el token de sesión se genera al login con `AUTH_SECRET`
- **2FA**: código OTP por email (Resend) en cada login (activable desde el panel)
- **Aislamiento por tags**: las VMs se filtran por tag de OLVM, un tenant no puede ver VMs de otro
- **Middleware**: bloquea acceso a APIs de otros tenants (403 o redirect)
- **Roles**: `superadmin` (global), `admin` (por tenant), `user` (por tenant), `operator` (solo lectura)
- **API read-only**: endpoint `/api/v1/*` con header `X-API-Key` (hereda memberships del usuario)

---

## 📂 Estructura del Proyecto

```
olvm-portal/
├── install.sh                     # Script de instalación interactiva
├── docker-compose.yml             # Orquestación de contenedores
├── start.sh                       # Entrypoint del contenedor portal
├── prisma/
│   ├── schema.prisma              # Esquema de la base de datos
│   └── migrations/                # Migraciones de Prisma
├── src/
│   ├── app/
│   │   ├── setup/page.tsx         # Wizard de instalación (/setup)
│   │   ├── page.tsx               # Dashboard principal
│   │   ├── login/                 # Página de login
│   │   ├── admin/
│   │   │   ├── clusters/          # Admin: Engines + Tenants
│   │   │   ├── users/             # Admin: Usuarios
│   │   │   ├── email/             # Admin: Config email
│   │   │   ├── branding/          # Admin: Branding
│   │   │   └── backups/           # Admin: Backups S3/Wasabi
│   │   └── api/
│   │       ├── setup/             # Endpoints del wizard (status, superadmin)
│   │       ├── admin/             # Endpoints admin (engines, clusters, users, email, secrets)
│   │       ├── tenants/[id]/      # Endpoints por tenant (VMs, OVA, ISOs, etc.)
│   │       └── v1/                # API read-only (X-API-Key)
│   ├── lib/
│   │   ├── olvmClient.ts          # Cliente REST API OLVM
│   │   ├── setupState.ts          # Detección de primer arranque
│   │   ├── engineStore.ts         # Store de engines (PostgreSQL)
│   │   ├── clusterStore.ts        # Store de tenants (PostgreSQL)
│   │   ├── userStore.ts           # Store de usuarios (PostgreSQL + bcrypt)
│   │   ├── crypto.ts              # Cifrado AES-256-GCM
│   │   ├── backupService.ts       # Motor de backups
│   │   └── email.ts               # Cliente Resend
│   ├── middleware.ts              # Protección de rutas + setup gating
│   └── auth.ts / auth-base.ts     # NextAuth config
└── scripts/
    └── backup-scheduler.cjs       # Scheduler de backups programados
```

---

## 📜 Licencia

Propietario — SixManager

---

<p align="center">
  Desarrollado por el equipo de SixManager
</p>
