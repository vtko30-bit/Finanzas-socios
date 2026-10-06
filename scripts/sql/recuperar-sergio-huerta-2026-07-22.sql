-- Sergio Huerta $100.000 (2026-07-22) omitido al importar: mismo dedupe_hash que
-- Guillermo Eric Morgado (misma fecha, monto y origen RG SpA, sin Id origen).
-- Tras corregir el hash en excel.ts, insertar desde import_rows con hash nuevo.

-- 1) Ver qué quedó en transactions con el hash colisionado
select id, date, amount, counterparty, origen_cuenta, concepto, dedupe_hash
from public.transactions
where dedupe_hash = '7c9d836fa1629ad45dcbbf0c17d514a55688c984b1792cc819a1798ea04a681e'
   or (date = '2026-07-22' and round(abs(amount::numeric), 0) = 100000
       and origen_cuenta ilike '%RG SpA%');

-- 2) Insertar Sergio Huerta si falta (hash con beneficiario + cuenta)
insert into public.transactions (
  id,
  organization_id,
  account_id,
  category_id,
  date,
  type,
  amount,
  currency,
  description,
  counterparty,
  payment_method,
  source_id,
  external_ref,
  origen_cuenta,
  source,
  import_batch_id,
  dedupe_hash,
  created_by,
  concepto,
  concept_id,
  flow_kind
)
select
  gen_random_uuid(),
  b.organization_id,
  null,
  null,
  (ir.normalized_json->>'date')::date,
  coalesce(ir.normalized_json->>'type', 'expense'),
  (ir.normalized_json->>'amount')::numeric,
  'CLP',
  coalesce(ir.normalized_json->>'description', ''),
  coalesce(ir.normalized_json->>'counterparty', ''),
  coalesce(ir.normalized_json->>'payment_method', ''),
  coalesce(ir.normalized_json->>'source_id', ''),
  coalesce(ir.normalized_json->>'external_ref', ''),
  coalesce(ir.normalized_json->>'account_name', ''),
  'excel_egresos',
  ir.batch_id,
  encode(
    digest(
      concat_ws(
        '|',
        ir.normalized_json->>'date',
        ir.normalized_json->>'type',
        trim(to_char((ir.normalized_json->>'amount')::numeric, 'FM999999990.00')),
        upper(regexp_replace(coalesce(ir.normalized_json->>'account_name', ''), '\s+', '', 'g')),
        upper(regexp_replace(coalesce(ir.normalized_json->>'external_ref', ''), '\s+', '', 'g')),
        upper(regexp_replace(coalesce(ir.normalized_json->>'counterparty', ''), '\s+', '', 'g')),
        upper(regexp_replace(coalesce(ir.normalized_json->>'payment_method', ''), '\s+', '', 'g'))
      ),
      'sha256'
    ),
    'hex'
  ),
  b.created_by,
  coalesce(ir.normalized_json->>'category_name', ''),
  null,
  'operativo'
from public.import_rows ir
join public.import_batches b on b.id = ir.batch_id
where ir.normalized_json->>'date' = '2026-07-22'
  and (ir.normalized_json->>'amount')::numeric = 100000
  and ir.normalized_json->>'counterparty' = 'Sergio Huerta'
  and ir.normalized_json->>'account_name' = 'RG SpA'
  and b.filename = 'Transferencias Banco de Chile 2026-07.xlsx'
order by b.created_at desc
limit 1
on conflict (organization_id, dedupe_hash) do nothing;

-- 3) Confirmar
select id, date, amount, counterparty, origen_cuenta, concepto, dedupe_hash
from public.transactions
where date = '2026-07-22'
  and round(abs(amount::numeric), 0) = 100000
  and origen_cuenta ilike '%RG SpA%'
order by counterparty;
