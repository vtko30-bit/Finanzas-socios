# Infraestructura recomendada

## Servicios
- Repositorio GitHub: 1 repo para app web.
- Vercel: despliegue de Next.js.
- Supabase: Auth + Postgres + Storage.

## Configuración Supabase
- Activar Auth con email magic link.
- Crear buckets:
  - `imports` (archivos de entrada)
  - `exports` (reportes descargables)
- Ejecutar migración `supabase/migrations/0001_init.sql`.
- Habilitar backup diario automático en proyecto de producción.

## Configuración Vercel
- Variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Entornos: Preview y Production con claves separadas.

## Git y ramas
- `main`: producción.
- `develop`: integración.
- Pull Requests obligatorios con revisión mínima de 1 persona.

## CI sugerida
- `npm run lint`
- `npm run build`
