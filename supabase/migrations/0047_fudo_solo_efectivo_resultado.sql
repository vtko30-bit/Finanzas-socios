-- De Fudo solo el efectivo entra al resultado. Tarjeta y transferencia vienen del banco.

create or replace function public.fudo_cuenta_en_resultado(
  p_source text,
  p_payment_method text
)
returns boolean
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_source, ''))) in ('fudo_ventas', 'fudo_gastos') then
      lower(translate(coalesce(p_payment_method, ''), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')) like '%efectivo%'
      or lower(trim(coalesce(p_payment_method, ''))) = 'cash'
    else true
  end;
$$;

grant execute on function public.fudo_cuenta_en_resultado(text, text) to authenticated;

create or replace function public.dashboard_metrics(
  p_org_id uuid,
  p_month_start date,
  p_month_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'month', (
      select jsonb_build_object(
        'income', coalesce(sum(case when type = 'income' then amount::numeric else 0 end), 0),
        'expense', coalesce(sum(case when type <> 'income' then amount::numeric else 0 end), 0),
        'count', count(*)::bigint
      )
      from transactions
      where organization_id = p_org_id
        and flow_kind = 'operativo'
        and (credit_id is null or source = 'creditos')
        and public.fudo_cuenta_en_resultado(source::text, payment_method::text)
        and date >= p_month_start
        and date <= p_month_end
    ),
    'total', (
      select jsonb_build_object(
        'income', coalesce(sum(case when type = 'income' then amount::numeric else 0 end), 0),
        'expense', coalesce(sum(case when type <> 'income' then amount::numeric else 0 end), 0),
        'count', count(*)::bigint
      )
      from transactions
      where organization_id = p_org_id
        and flow_kind = 'operativo'
        and (credit_id is null or source = 'creditos')
        and public.fudo_cuenta_en_resultado(source::text, payment_method::text)
    )
  );
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
    and public.fudo_cuenta_en_resultado(t.source::text, t.payment_method::text)
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
    and public.fudo_cuenta_en_resultado(t.source::text, t.payment_method::text)
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
    and public.fudo_cuenta_en_resultado(t.source::text, t.payment_method::text)
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
      and upper(trim(coalesce(t.description::text, ''))) like 'TEF%'
      and lower(trim(coalesce(t.origen_cuenta::text, ''))) not like '%transferencias%'
      and exists (
        select 1
        from public.transactions t2
        where t2.organization_id = t.organization_id
          and t2.id <> t.id
          and coalesce(t2.flow_kind, 'operativo') = 'operativo'
          and lower(trim(t2.type::text)) in ('expense', 'gasto', 'egreso')
          and lower(trim(coalesce(t2.source::text, ''))) = 'excel_egresos'
          and (
            public.es_fila_transferencias_be_dedupe(t2.origen_cuenta::text)
            or (
              public.origen_familia_banco_dedupe(t2.origen_cuenta::text) = 'be'
              and upper(trim(coalesce(t2.description::text, ''))) not like 'TEF%'
            )
          )
          and (
            (
              t2.date = t.date
              and round(abs(t2.amount::numeric), 2) = round(abs(t.amount::numeric), 2)
            )
            or (
              nullif(trim(coalesce(t.external_ref::text, '')), '') is not null
              and trim(coalesce(t2.external_ref::text, '')) = trim(coalesce(t.external_ref::text, ''))
              and round(abs(t2.amount::numeric), 2) = round(abs(t.amount::numeric), 2)
            )
          )
      )
    )
    and not (
      lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos'
      and lower(trim(coalesce(t.origen_cuenta::text, ''))) not like '%transferencias%'
      and public.origen_familia_banco_dedupe(t.origen_cuenta::text) is not null
      and not (
        public.origen_familia_banco_dedupe(t.origen_cuenta::text) = 'be'
        and upper(trim(coalesce(t.description::text, ''))) like 'TEF%'
      )
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
    and not (
      lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos'
      and lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%transferencias%'
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
          and t2.date = t.date
          and t2.amount = t.amount
          and (
            t2.created_at < t.created_at
            or (t2.created_at = t.created_at and t2.id::text < t.id::text)
          )
      )
    )
  group by 1, 2, 3;
$$;
