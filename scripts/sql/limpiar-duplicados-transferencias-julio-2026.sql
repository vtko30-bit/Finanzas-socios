-- Elimina duplicados de transferencias sin Id origen (reimportación tras cambio de hash).
-- Conserva el registro más reciente por: fecha, monto, origen, beneficiario, cuenta, n° op.

-- 1) Ver duplicados en julio 2026 (ajusta fechas si hace falta)
with keyed as (
  select
    id,
    date,
    amount,
    counterparty,
    origen_cuenta,
    payment_method,
    external_ref,
    dedupe_hash,
    created_at,
    row_number() over (
      partition by
        organization_id,
        date,
        round(abs(amount::numeric), 2),
        upper(regexp_replace(coalesce(origen_cuenta, ''), '\s+', '', 'g')),
        upper(regexp_replace(coalesce(counterparty, ''), '\s+', '', 'g')),
        upper(regexp_replace(coalesce(payment_method, ''), '\s+', '', 'g')),
        upper(regexp_replace(coalesce(external_ref, ''), '\s+', '', 'g'))
      order by created_at desc nulls last, id desc
    ) as rn
  from public.transactions
  where type = 'expense'
    and coalesce(trim(source_id), '') = ''
    and date >= '2026-07-01'
    and date < '2026-08-01'
)
select id, date, amount, counterparty, origen_cuenta, payment_method, dedupe_hash, rn
from keyed
where rn > 1
order by date, counterparty;

-- 2) Borrar duplicados (ejecutar solo si el paso 1 muestra filas correctas)
-- delete from public.transactions
-- where id in (
--   select id
--   from (
--     select
--       id,
--       row_number() over (
--         partition by
--           organization_id,
--           date,
--           round(abs(amount::numeric), 2),
--           upper(regexp_replace(coalesce(origen_cuenta, ''), '\s+', '', 'g')),
--           upper(regexp_replace(coalesce(counterparty, ''), '\s+', '', 'g')),
--           upper(regexp_replace(coalesce(payment_method, ''), '\s+', '', 'g')),
--           upper(regexp_replace(coalesce(external_ref, ''), '\s+', '', 'g'))
--         order by created_at desc nulls last, id desc
--       ) as rn
--     from public.transactions
--     where type = 'expense'
--       and coalesce(trim(source_id), '') = ''
--       and date >= '2026-07-01'
--       and date < '2026-08-01'
--   ) d
--   where rn > 1
-- );
