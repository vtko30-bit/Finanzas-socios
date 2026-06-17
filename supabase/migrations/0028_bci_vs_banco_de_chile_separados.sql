-- BCI y Banco de Chile son bancos distintos: dedupe y etiquetas solo dentro del mismo banco.

create or replace function public.origen_familia_banco_dedupe(p_origen text)
returns text
language sql
immutable
as $$
  with n as (
    select lower(regexp_replace(
      translate(
        coalesce(trim(p_origen), ''),
        'áéíóúüñÁÉÍÓÚÜÑ',
        'aeiouunaeiouun'
      ),
      '[^a-z0-9]', '', 'g'
    )) as k
  )
  select case
    when k = '' then null
    when k like '%transbe%' or k like '%movbe%' or k like '%ingbe%' or k like '%pagobe%' then 'be'
    when k like '%transcl%' or k like '%movbdch%' or k like '%ingbdch%' then 'bdch'
    when k like '%transbci%' or k like '%movbci%' or k like '%ingbci%' then 'bci'
    when k like '%transferencias%' or k like '%transferencia%' then case
      when k like '%bci%' then 'bci'
      when k like '%chile%' or k like '%bancodechile%' then 'bdch'
      when k like '%banco%' or k like '%bestado%' or k like '%estado%' then 'be'
      else null
    end
    when k like '%bci%' then 'bci'
    when k like '%chile%' or k like '%bancodechile%' then 'bdch'
    when k = 'rg' or k like 'rg%' or k like '%bancoestado%' or k like '%bestado%' then 'be'
    when k = 'happy' or k like 'happy%' then 'bci'
    else null
  end
  from n;
$$;

-- Corrige transferencias BCI etiquetadas erróneamente como trans_cl (0026).
alter table public.transactions disable trigger transactions_import_period_lock_guard;

update public.transactions t
set origen_cuenta = regexp_replace(trim(t.origen_cuenta::text), ' · trans_cl$', ' · trans_bci')
where lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos'
  and lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%transferencias%'
  and lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%bci%'
  and not lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%chile%'
  and trim(coalesce(t.origen_cuenta::text, '')) like '% · trans_cl';

alter table public.transactions enable trigger transactions_import_period_lock_guard;

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
    and not (
      lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos_banco_estado_servicios'
      and exists (
        select 1
        from public.transactions t2
        where t2.organization_id = t.organization_id
          and t2.date = t.date
          and t2.amount = t.amount
          and t2.id <> t.id
          and coalesce(t2.flow_kind, 'operativo') = 'operativo'
          and lower(trim(t2.type::text)) in ('expense', 'gasto', 'egreso')
          and lower(trim(coalesce(t2.source::text, ''))) = 'excel_egresos'
      )
    )
    and not (
      lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos'
      and lower(trim(coalesce(t.origen_cuenta::text, ''))) not like '%transferencias%'
      and public.origen_familia_banco_dedupe(t.origen_cuenta::text) is not null
      and exists (
        select 1
        from public.transactions t2
        where t2.organization_id = t.organization_id
          and t2.id <> t.id
          and coalesce(t2.flow_kind, 'operativo') = 'operativo'
          and lower(trim(t2.type::text)) in ('expense', 'gasto', 'egreso')
          and lower(trim(coalesce(t2.source::text, ''))) = 'excel_egresos'
          and lower(trim(coalesce(t2.origen_cuenta::text, ''))) like '%transferencias%'
          and public.origen_familia_banco_dedupe(t2.origen_cuenta::text)
            = public.origen_familia_banco_dedupe(t.origen_cuenta::text)
          and (
            (
              nullif(trim(coalesce(t.external_ref::text, '')), '') is not null
              and trim(coalesce(t2.external_ref::text, '')) = trim(coalesce(t.external_ref::text, ''))
            )
            or (
              t2.date = t.date
              and t2.amount = t.amount
              and (
                upper(trim(coalesce(t.description::text, ''))) like 'TEF%'
                or upper(trim(coalesce(t.description::text, ''))) like 'TRANSFERENCIA%'
                or upper(trim(coalesce(t.description::text, ''))) like 'TRANSF %'
              )
            )
          )
      )
    )
  group by 1, 2, 3;
$$;
