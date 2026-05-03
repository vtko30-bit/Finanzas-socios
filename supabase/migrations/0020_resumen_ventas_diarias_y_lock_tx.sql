-- 1) Ventas agregadas por día (en lugar de solo por mes) en resumen_pivot_operativo_agg.
-- 2) Ventas diarias por origen_cuenta (desglose por sucursal).
-- 3) Trigger: no insertar/actualizar/borrar movimientos cuya fecha cae en un período cerrado.

create or replace function public.resumen_pivot_operativo_agg(
  p_organization_id uuid,
  p_desde date,
  p_hasta date,
  p_sucursal_substr text,
  p_solo_sucursales_fijas boolean,
  p_excluded_family_ids uuid[]
)
returns table (
  section text,
  ym text,
  dim_key text,
  amount_sum numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    'income_venta_daily'::text as section,
    to_char(t.date::timestamp, 'YYYY-MM-DD') as ym,
    coalesce(nullif(trim(t.payment_method::text), ''), '')::text as dim_key,
    sum(t.amount)::numeric as amount_sum
  from public.transactions t
  left join public.concept_catalog cc on cc.id = t.concept_id
  where t.organization_id = p_organization_id
    and t.date >= p_desde
    and t.date <= p_hasta
    and coalesce(t.flow_kind, 'operativo') = 'operativo'
    and lower(trim(t.type::text)) in ('income', 'ingreso')
    and (
      cardinality(coalesce(p_excluded_family_ids, '{}'::uuid[])) = 0
      or cc.family_id is null
      or not (cc.family_id = any (coalesce(p_excluded_family_ids, '{}'::uuid[])))
    )
    and (
      p_sucursal_substr is null
      or length(trim(p_sucursal_substr)) = 0
      or length(trim(p_sucursal_substr)) > 200
      or t.origen_cuenta ilike '%' || trim(p_sucursal_substr) || '%'
    )
    and (
      not p_solo_sucursales_fijas
      or not public.resumen_tx_es_evento_sucursal(t.origen_cuenta)
    )
    and not public.resumen_tx_es_evento_sucursal(t.origen_cuenta)
  group by 1, 2, 3

  union all

  select
    'income_evento_daily'::text,
    to_char(t.date::timestamp, 'YYYY-MM-DD'),
    coalesce(nullif(trim(t.origen_cuenta::text), ''), 'EVENTO_SinSucursal')::text,
    sum(t.amount)::numeric
  from public.transactions t
  left join public.concept_catalog cc on cc.id = t.concept_id
  where t.organization_id = p_organization_id
    and t.date >= p_desde
    and t.date <= p_hasta
    and coalesce(t.flow_kind, 'operativo') = 'operativo'
    and lower(trim(t.type::text)) in ('income', 'ingreso')
    and (
      cardinality(coalesce(p_excluded_family_ids, '{}'::uuid[])) = 0
      or cc.family_id is null
      or not (cc.family_id = any (coalesce(p_excluded_family_ids, '{}'::uuid[])))
    )
    and (
      p_sucursal_substr is null
      or length(trim(p_sucursal_substr)) = 0
      or length(trim(p_sucursal_substr)) > 200
      or t.origen_cuenta ilike '%' || trim(p_sucursal_substr) || '%'
    )
    and (
      not p_solo_sucursales_fijas
      or not public.resumen_tx_es_evento_sucursal(t.origen_cuenta)
    )
    and public.resumen_tx_es_evento_sucursal(t.origen_cuenta)
  group by 1, 2, 3

  union all

  select
    'expense_familia'::text,
    to_char(date_trunc('month', t.date::timestamp), 'YYYY-MM'),
    coalesce(nullif(trim(cf.name::text), ''), 'Sin familia')::text,
    sum(t.amount)::numeric
  from public.transactions t
  left join public.concept_catalog cc on cc.id = t.concept_id
  left join public.concept_families cf on cf.id = cc.family_id
  where t.organization_id = p_organization_id
    and t.date >= p_desde
    and t.date <= p_hasta
    and coalesce(t.flow_kind, 'operativo') = 'operativo'
    and lower(trim(t.type::text)) in ('expense', 'gasto', 'egreso')
    and (
      cardinality(coalesce(p_excluded_family_ids, '{}'::uuid[])) = 0
      or cc.family_id is null
      or not (cc.family_id = any (coalesce(p_excluded_family_ids, '{}'::uuid[])))
    )
    and (
      p_sucursal_substr is null
      or length(trim(p_sucursal_substr)) = 0
      or length(trim(p_sucursal_substr)) > 200
      or t.origen_cuenta ilike '%' || trim(p_sucursal_substr) || '%'
    )
    and (
      not p_solo_sucursales_fijas
      or not public.resumen_tx_es_evento_sucursal(t.origen_cuenta)
    )
  group by 1, 2, 3;
$$;

create or replace function public.resumen_ventas_diarias_por_origen_agg(
  p_organization_id uuid,
  p_desde date,
  p_hasta date,
  p_solo_sucursales_fijas boolean,
  p_excluded_family_ids uuid[]
)
returns table (
  origen_cuenta text,
  fecha_ymd text,
  payment_method text,
  amount_sum numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(nullif(trim(t.origen_cuenta::text), ''), 'Sin sucursal')::text,
    to_char(t.date::timestamp, 'YYYY-MM-DD')::text,
    coalesce(nullif(trim(t.payment_method::text), ''), '')::text,
    sum(t.amount)::numeric
  from public.transactions t
  left join public.concept_catalog cc on cc.id = t.concept_id
  where t.organization_id = p_organization_id
    and t.date >= p_desde
    and t.date <= p_hasta
    and coalesce(t.flow_kind, 'operativo') = 'operativo'
    and lower(trim(t.type::text)) in ('income', 'ingreso')
    and (
      cardinality(coalesce(p_excluded_family_ids, '{}'::uuid[])) = 0
      or cc.family_id is null
      or not (cc.family_id = any (coalesce(p_excluded_family_ids, '{}'::uuid[])))
    )
    and (
      not p_solo_sucursales_fijas
      or not public.resumen_tx_es_evento_sucursal(t.origen_cuenta)
    )
  group by 1, 2, 3;
$$;

grant execute on function public.resumen_ventas_diarias_por_origen_agg(
  uuid,
  date,
  date,
  boolean,
  uuid[]
) to authenticated;

create or replace function public.transactions_block_if_import_period_locked()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  org uuid;
  d date;
  d_new date;
  locked boolean;
begin
  if tg_op = 'INSERT' then
    org := new.organization_id;
    d := new.date;
    select exists (
      select 1
      from public.import_period_locks l
      where l.organization_id = org
        and d >= l.period_start
        and d < l.period_end_excl
    ) into locked;
    if locked then
      raise exception 'Período cerrado: no se permiten cambios en movimientos con fecha %.', d
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    org := old.organization_id;
    d := old.date;
    select exists (
      select 1
      from public.import_period_locks l
      where l.organization_id = org
        and d >= l.period_start
        and d < l.period_end_excl
    ) into locked;
    if locked then
      raise exception 'Período cerrado: no se puede eliminar un movimiento con fecha %.', d
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    org := coalesce(new.organization_id, old.organization_id);
    d := old.date;
    d_new := new.date;
    select exists (
      select 1
      from public.import_period_locks l
      where l.organization_id = org
        and (
          (d >= l.period_start and d < l.period_end_excl)
          or (d_new >= l.period_start and d_new < l.period_end_excl)
        )
    ) into locked;
    if locked then
      raise exception 'Período cerrado: no se permiten cambios en movimientos cuya fecha afecta un período cerrado.'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  return null;
end;
$$;

drop trigger if exists transactions_import_period_lock_guard on public.transactions;

create trigger transactions_import_period_lock_guard
before insert or update or delete on public.transactions
for each row execute function public.transactions_block_if_import_period_locked();
