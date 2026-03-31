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
3. Importar Excel consolidado (`/importar`)
4. Validar dashboard y exportar reportes (`/reportes`)

## Infra y operación

Documentación:
- `docs/infraestructura.md`
- `docs/respaldo-y-operacion.md`
