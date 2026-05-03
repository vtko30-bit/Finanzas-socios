-- Agregación en base de datos para el resumen pivot (operativo), evitando paginar
-- todas las transacciones de ingreso/egreso en el servidor de aplicación.

create or replace function public.resumen_norm_texto_evento(p text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        normalize(lower(coalesce(p, '')::text), NFD),
        E'[\u0300-\u036f]',
        '',
        'g'
      ),
      '^[^a-z0-9]+',
      '',
      'g'
    )
  );
$$;

create or replace function public.resumen_tx_es_evento_sucursal(p_origen text)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when trim(public.resumen_norm_texto_evento(p_origen)) = '' then false
    else position('evento' in trim(public.resumen_norm_texto_evento(p_origen))) > 0
  end;
$$;

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
    'income_venta'::text as section,
    to_char(date_trunc('month', t.date::timestamp), 'YYYY-MM') as ym,
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
    'income_evento'::text,
    to_char(date_trunc('month', t.date::timestamp), 'YYYY-MM'),
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

grant execute on function public.resumen_pivot_operativo_agg(
  uuid,
  date,
  date,
  text,
  boolean,
  uuid[]
) to authenticated;
