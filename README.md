# Finanzas Socios (MVP)

App financiera multiusuario para socios de negocio, con:
- autenticación y control por organización,
- importación de Excel (gastos hoja Egresos, otros ingresos hoja Ingresos, ventas),
- dashboard con KPIs base,
- exportación CSV/XLSX,
- respaldo y auditoría básica.

## Stack

- Next.js (App Router)
- Supabase (Auth + Postgres + Storage)
- Vercel (deploy)
- `xlsx` para importaciones

## Variables de entorno

Copiar `.env.example` a `.env.local` y completar:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Opcional — ventas automáticas desde Fudo (`/importar` y cron diario):

- `FUDO_RG_API_KEY` / `FUDO_RG_API_SECRET`
- `FUDO_HAPPY_API_KEY` / `FUDO_HAPPY_API_SECRET`
- `CRON_SECRET` (Vercel Cron llama `GET /api/fudo/cron`)
- `FINANZAS_ORGANIZATION_ID` (si hay más de una organización)

Si las keys se compartieron por chat o ticket, rotarlas en Fudo.

### Separar DEV y PROD (recomendado)

Para evitar mezclar datos reales con pruebas:

1. Crea dos archivos locales (no se suben a git):
   - `.env.local.dev`
   - `.env.local.prod`
2. Usa como base:
   - `config/env/.env.local.dev.example`
   - `config/env/.env.local.prod.example`
3. Cambia rapido de entorno (PowerShell):
   - DEV: `.\scripts\env\use-dev.ps1`
   - PROD: `.\scripts\env\use-prod.ps1`
4. Verifica a que proyecto estas apuntando:
   - `npm run env:check`

## Levantar local

```bash
npm install
npm run dev
```

## Base de datos y RLS

Ejecutar migración SQL:
- `supabase/migrations/0001_init.sql`

Esto crea tablas núcleo: organizaciones, membresías, transacciones, lotes de importación, auditoría y reportes.

## Flujo recomendado

1. Login con magic link (`/login`)
2. Crear organización inicial (`POST /api/setup/bootstrap`)
3. Importar Excel consolidado (`/importar`) o **Actualizar ventas desde Fudo**
4. Validar dashboard y exportar reportes (`/reportes`)

### Ventas desde Fudo (Rg + Happy)

En `/importar`, elige un rango (máx. 31 días) y pulsa **Actualizar desde Fudo**.
Las ventas ya cargadas (mismo Id de Fudo, también las del Excel) no se duplican.

El cron diario (`vercel.json`) trae el día anterior (hora Chile). En Vercel configura
`CRON_SECRET` y las keys `FUDO_*`.

## Infra y operación

Documentación:
- `docs/infraestructura.md`
- `docs/respaldo-y-operacion.md`
