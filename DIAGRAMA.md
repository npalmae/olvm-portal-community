markdown
# Diagrama de Arquitectura - OVM Portal

## Diagrama General

\`\`\`mermaid
graph TB
    USUARIO["👤 Usuario"] --> PORTAL["🚀 OVM Portal"]
    PORTAL --> OLVM["☁️ OLVM Manager"]
    OLVM --> VM1["🖥️ Lab-TESTVM1 (tenant-a)"]
    OLVM --> VM2["🖥️ Lab-TESTVM1-tenant2 (tenant-b)"]
\`\`\`

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 15 + React 18 |
| Auth | Auth.js v5 + bcryptjs |
| Consolas | noVNC |
| API | OLVM REST API |

## VMs

- Lab-TESTVM1 → Tag: tenant-a
- Lab-TESTVM1-tenant2 → Tag: tenant-b (3GB RAM, 2 CPU)

## URLs

- Portal: http://localhost:3000
- OLVM: https://ocloudqa.sixmanager.cl
