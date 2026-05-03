-- Normalización segura de `transactions.credit_component` antes de la migración 0015.
-- Objetivo: evitar fallo de la constraint nueva sin perder trazabilidad.
--
-- Uso recomendado:
-- 1) Ejecuta primero `verificacion-pre-migracion-credit-component.sql`.
-- 2) Si aparecen valores inválidos, ejecuta este script.
-- 3) Re-ejecuta la verificación y luego aplica la migración 0015.

-- ---------------------------------------------------------------------------
-- A) Preview: qué valores no permitidos existen hoy
-- ---------------------------------------------------------------------------
select
  credit_component,
  count(*) as total
from public.transactions
where credit_component is not null
  and credit_component not in (
    'desembolso',
    'pago_capital',
    'pago_interes',
    'comision',
    'cuota',
    'prestamo_otorgado',
    'prestamo_otorgado_conciliado',
    'recupero_prestamo'
  )
group by credit_component
order by total desc;

-- ---------------------------------------------------------------------------
-- B) Normalización en transacción (con respaldo)
--    - Mapea variantes comunes a valores permitidos.
--    - Lo que no se pueda mapear se deja en NULL (no rompe constraint).
-- ---------------------------------------------------------------------------
begin;

create table if not exists public.transactions_credit_component_fix_backup_20260429 as
select
  t.id,
  t.organization_id,
  t.credit_component as credit_component_original,
  now() as backed_up_at
from public.transactions t
where t.credit_component is not null
  and t.credit_component not in (
    'desembolso',
    'pago_capital',
    'pago_interes',
    'comision',
    'cuota',
    'prestamo_otorgado',
    'prestamo_otorgado_conciliado',
    'recupero_prestamo'
  );

update public.transactions t
set credit_component =
  case
    -- mapeos comunes
    when lower(trim(t.credit_component)) in ('prestamo', 'prestamo_otorgado') then 'prestamo_otorgado'
    when lower(trim(t.credit_component)) in ('prestamo conciliado', 'prestamo_otorgado conciliado', 'prestamo_conciliado')
      then 'prestamo_otorgado_conciliado'
    when lower(trim(t.credit_component)) in ('desembolso prestamo', 'desembolso_prestamo')
      then 'desembolso'
    when lower(trim(t.credit_component)) in ('capital', 'pago capital')
      then 'pago_capital'
    when lower(trim(t.credit_component)) in ('interes', 'pago interes')
      then 'pago_interes'
    when lower(trim(t.credit_component)) in ('comisión')
      then 'comision'
    when lower(trim(t.credit_component)) in ('recupero', 'recupero prestamo')
      then 'recupero_prestamo'

    -- fallback seguro: si no coincide, dejar null para no romper la nueva regla
    else null
  end
where t.credit_component is not null
  and t.credit_component not in (
    'desembolso',
    'pago_capital',
    'pago_interes',
    'comision',
    'cuota',
    'prestamo_otorgado',
    'prestamo_otorgado_conciliado',
    'recupero_prestamo'
  );

commit;
-- rollback;

-- ---------------------------------------------------------------------------
-- C) Verificación posterior (debe retornar 0 filas)
-- ---------------------------------------------------------------------------
select
  credit_component,
  count(*) as total
from public.transactions
where credit_component is not null
  and credit_component not in (
    'desembolso',
    'pago_capital',
    'pago_interes',
    'comision',
    'cuota',
    'prestamo_otorgado',
    'prestamo_otorgado_conciliado',
    'recupero_prestamo'
  )
group by credit_component
order by total desc;

