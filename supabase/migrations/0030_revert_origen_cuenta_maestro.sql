-- Revierte etiquetas origen_cuenta con códigos de maestro (0026–0029) al formato anterior.
-- No borra movimientos: solo restaura el texto de origen_cuenta.

alter table public.transactions disable trigger transactions_import_period_lock_guard;

-- Cartola normalizada
update public.transactions
set origen_cuenta = 'Rg'
where trim(coalesce(origen_cuenta::text, '')) = 'Rg · mov_be';

update public.transactions
set origen_cuenta = 'Happy'
where trim(coalesce(origen_cuenta::text, '')) in ('Happy · mov_bci', 'Happy · mov_bdch');

-- Transferencias (etiqueta corta o nombre largo + código)
update public.transactions
set origen_cuenta = 'Transferencias Banco Estado'
where trim(coalesce(origen_cuenta::text, '')) in (
  'Rg · trans_be',
  'Transferencias Banco Estado · trans_be'
);

update public.transactions
set origen_cuenta = 'Transferencias Banco de Chile'
where trim(coalesce(origen_cuenta::text, '')) in (
  'Happy · trans_cl',
  'Happy · trans_bci',
  'Transferencias Banco de Chile · trans_cl',
  'Transferencias Banco de Chile · trans_bci'
);

-- Otros ingresos
update public.transactions
set origen_cuenta = 'Banco Estado'
where trim(coalesce(origen_cuenta::text, '')) = 'Banco Estado · ing_be';

update public.transactions
set origen_cuenta = 'Bci'
where trim(coalesce(origen_cuenta::text, '')) = 'Bci · ing_bci';

update public.transactions
set origen_cuenta = 'Banco de Chile'
where trim(coalesce(origen_cuenta::text, '')) = 'Banco de Chile · ing_bdch';

-- Pago servicios y cualquier otro sufijo · codigo_maestro restante
update public.transactions
set origen_cuenta = regexp_replace(
  trim(coalesce(origen_cuenta::text, '')),
  ' · (mov_be|mov_bci|mov_bdch|trans_be|trans_bci|trans_cl|ing_be|ing_bci|ing_bdch|pago_be)$',
  ''
)
where coalesce(origen_cuenta::text, '') ~ ' · (mov_be|mov_bci|mov_bdch|trans_be|trans_bci|trans_cl|ing_be|ing_bci|ing_bdch|pago_be)$';

alter table public.transactions enable trigger transactions_import_period_lock_guard;

-- RPC resumen: volver a lógica previa a origen_familia_banco (0025).
drop function if exists public.origen_familia_banco_dedupe(text);

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
      and exists (
        select 1
        from public.transactions t2
        where t2.organization_id = t.organization_id
          and t2.id <> t.id
          and coalesce(t2.flow_kind, 'operativo') = 'operativo'
          and lower(trim(t2.type::text)) in ('expense', 'gasto', 'egreso')
          and lower(trim(coalesce(t2.source::text, ''))) = 'excel_egresos'
          and lower(trim(coalesce(t2.origen_cuenta::text, ''))) like '%transferencias%'
          and (
            lower(trim(coalesce(t2.origen_cuenta::text, ''))) like '%banco%'
            or lower(trim(coalesce(t2.origen_cuenta::text, ''))) like '%bestado%'
            or lower(trim(coalesce(t2.origen_cuenta::text, ''))) like '%bci%'
            or lower(trim(coalesce(t2.origen_cuenta::text, ''))) like '%chile%'
          )
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
