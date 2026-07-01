-- Retiros Mercado Pago: duplicados (Sin origen vs Retiros_Mercado_Pago, o mismo retiro repetido).
-- Ejecutar en Supabase SQL Editor (organization_id: fea07b74-332b-4f39-832b-dcb27582f011).

-- =============================================================================
-- Paso 1 — PREVIEW: filas "Sin origen" que tienen espejo con origen Retiros MP
-- =============================================================================
select
  t.id,
  t.date,
  t.amount,
  t.counterparty,
  t.external_ref,
  t.source_id,
  t.origen_cuenta,
  t.import_batch_id,
  t.created_at
from public.transactions t
where t.organization_id = 'fea07b74-332b-4f39-832b-dcb27582f011'::uuid
  and t.type = 'expense'
  and t.source = 'excel_egresos'
  and lower(trim(coalesce(t.origen_cuenta, ''))) in ('sin origen', '')
  and exists (
    select 1
    from public.transactions t2
    where t2.organization_id = t.organization_id
      and t2.id <> t.id
      and t2.type = t.type
      and t2.source = t.source
      and t2.date = t.date
      and round(t2.amount::numeric, 2) = round(t.amount::numeric, 2)
      and lower(regexp_replace(coalesce(t2.counterparty, ''), '\s+', ' ', 'g'))
        = lower(regexp_replace(coalesce(t.counterparty, ''), '\s+', ' ', 'g'))
      and lower(regexp_replace(coalesce(t2.external_ref, ''), '\s+', ' ', 'g'))
        = lower(regexp_replace(coalesce(t.external_ref, ''), '\s+', ' ', 'g'))
      and lower(coalesce(t2.origen_cuenta, '')) like '%retiros%'
      and lower(coalesce(t2.origen_cuenta, '')) like '%mercado%'
  )
order by t.date desc, t.amount desc;

-- =============================================================================
-- Paso 2 — BACKUP (opcional)
-- =============================================================================
-- create table public.transactions_backup_retiros_mp_dup_20260617 as
-- select t.*
-- from public.transactions t
-- where t.organization_id = 'fea07b74-332b-4f39-832b-dcb27582f011'::uuid
--   and t.id in (
--     /* pegar ids del paso 1 + paso 3 */
--   );

-- =============================================================================
-- Paso 3 — PREVIEW: retiros MP duplicados (mismo día + monto + destino + N° op.)
-- =============================================================================
with base as (
  select
    t.id,
    t.date,
    round(t.amount::numeric, 2) as amount_n,
    lower(regexp_replace(coalesce(t.counterparty, ''), '\s+', ' ', 'g')) as cp,
    lower(regexp_replace(coalesce(t.external_ref, ''), '\s+', ' ', 'g')) as op,
    t.origen_cuenta,
    t.source_id,
    t.created_at,
    row_number() over (
      partition by
        t.date,
        round(t.amount::numeric, 2),
        lower(regexp_replace(coalesce(t.counterparty, ''), '\s+', ' ', 'g')),
        lower(regexp_replace(coalesce(t.external_ref, ''), '\s+', ' ', 'g'))
      order by
        case when lower(coalesce(t.origen_cuenta, '')) like '%retiros%' then 0 else 1 end,
        t.created_at asc,
        t.id asc
    ) as rn
  from public.transactions t
  where t.organization_id = 'fea07b74-332b-4f39-832b-dcb27582f011'::uuid
    and t.type = 'expense'
    and t.source = 'excel_egresos'
    and (
      lower(coalesce(t.origen_cuenta, '')) like '%retiros%mercado%'
      or lower(coalesce(t.origen_cuenta, '')) in ('sin origen', '')
    )
)
select *
from base
where rn > 1
order by date desc, amount_n desc;

-- =============================================================================
-- Paso 4 — DELETE: quitar espejos "Sin origen" (conserva Retiros_Mercado_Pago)
-- =============================================================================
-- delete from public.transactions t
-- where t.organization_id = 'fea07b74-332b-4f39-832b-dcb27582f011'::uuid
--   and t.type = 'expense'
--   and t.source = 'excel_egresos'
--   and lower(trim(coalesce(t.origen_cuenta, ''))) in ('sin origen', '')
--   and exists (
--     select 1
--     from public.transactions t2
--     where t2.organization_id = t.organization_id
--       and t2.id <> t.id
--       and t2.type = t.type
--       and t2.source = t.source
--       and t2.date = t.date
--       and round(t2.amount::numeric, 2) = round(t.amount::numeric, 2)
--       and lower(regexp_replace(coalesce(t2.counterparty, ''), '\s+', ' ', 'g'))
--         = lower(regexp_replace(coalesce(t.counterparty, ''), '\s+', ' ', 'g'))
--       and lower(regexp_replace(coalesce(t2.external_ref, ''), '\s+', ' ', 'g'))
--         = lower(regexp_replace(coalesce(t.external_ref, ''), '\s+', ' ', 'g'))
--       and lower(coalesce(t2.origen_cuenta, '')) like '%retiros%'
--       and lower(coalesce(t2.origen_cuenta, '')) like '%mercado%'
--   );

-- =============================================================================
-- Paso 5 — DELETE: retiros MP repetidos (deja el más antiguo con origen Retiros)
-- =============================================================================
-- with ranked as (
--   select
--     t.id,
--     row_number() over (
--       partition by
--         t.date,
--         round(t.amount::numeric, 2),
--         lower(regexp_replace(coalesce(t.counterparty, ''), '\s+', ' ', 'g')),
--         lower(regexp_replace(coalesce(t.external_ref, ''), '\s+', ' ', 'g'))
--       order by
--         case when lower(coalesce(t.origen_cuenta, '')) like '%retiros%' then 0 else 1 end,
--         t.created_at asc,
--         t.id asc
--     ) as rn
--   from public.transactions t
--   where t.organization_id = 'fea07b74-332b-4f39-832b-dcb27582f011'::uuid
--     and t.type = 'expense'
--     and t.source = 'excel_egresos'
--     and lower(coalesce(t.origen_cuenta, '')) like '%retiros%'
--     and lower(coalesce(t.origen_cuenta, '')) like '%mercado%'
-- )
-- delete from public.transactions t
-- using ranked r
-- where t.id = r.id
--   and r.rn > 1;

-- =============================================================================
-- Paso 6 — VERIFICAR: no deben quedar grupos con count > 1
-- =============================================================================
-- select
--   t.date,
--   round(t.amount::numeric, 2) as amount,
--   t.counterparty,
--   t.external_ref,
--   count(*) as n
-- from public.transactions t
-- where t.organization_id = 'fea07b74-332b-4f39-832b-dcb27582f011'::uuid
--   and t.type = 'expense'
--   and t.source = 'excel_egresos'
--   and lower(coalesce(t.origen_cuenta, '')) like '%retiros%'
-- group by 1, 2, 3, 4
-- having count(*) > 1
-- order by 1 desc;

-- =============================================================================
-- Paso 7 — Reimportaciones (mismo día + monto + destino, distinto Id / N° op.)
-- Preview: conservar rn=1 (más antiguo), borrar rn>1
-- =============================================================================
-- with base as (
--   select
--     t.id,
--     t.date,
--     round(t.amount::numeric, 2) as amount_n,
--     t.counterparty,
--     t.external_ref,
--     t.source_id,
--     t.concepto,
--     t.created_at,
--     row_number() over (
--       partition by
--         t.date,
--         round(t.amount::numeric, 2),
--         lower(trim(coalesce(t.counterparty, '')))
--       order by t.created_at asc, t.id asc
--     ) as rn,
--     count(*) over (
--       partition by
--         t.date,
--         round(t.amount::numeric, 2),
--         lower(trim(coalesce(t.counterparty, '')))
--     ) as total_en_grupo
--   from public.transactions t
--   where t.organization_id = 'fea07b74-332b-4f39-832b-dcb27582f011'::uuid
--     and t.type = 'expense'
--     and t.source = 'excel_egresos'
--     and lower(coalesce(t.origen_cuenta, '')) like '%retiros%'
-- )
-- select * from base where total_en_grupo > 1 and rn > 1 order by date desc;

-- delete from public.transactions t
-- using (
--   with base as (
--     select
--       t.id,
--       row_number() over (
--         partition by
--           t.date,
--           round(t.amount::numeric, 2),
--           lower(trim(coalesce(t.counterparty, '')))
--         order by t.created_at asc, t.id asc
--       ) as rn,
--       count(*) over (
--         partition by
--           t.date,
--           round(t.amount::numeric, 2),
--           lower(trim(coalesce(t.counterparty, '')))
--       ) as total_en_grupo
--     from public.transactions t
--     where t.organization_id = 'fea07b74-332b-4f39-832b-dcb27582f011'::uuid
--       and t.type = 'expense'
--       and t.source = 'excel_egresos'
--       and lower(coalesce(t.origen_cuenta, '')) like '%retiros%'
--   )
--   select id from base where total_en_grupo > 1 and rn > 1
-- ) d
-- where t.id = d.id;
