-- Recuperar fila omitida al importar (mismo día+monto, Id distinto).
-- Caso: 135691070604 Arriendo Bodega vs 135691070603 devolucion prestamo (2026-05-04, 200000).

-- 1) Ver cuál Id está en transactions
select source_id, date, amount, description, origen_cuenta
from public.transactions
where source_id in ('135691070603', '135691070604')
   or (date = '2026-05-04' and round(abs(amount::numeric), 2) = 200000.00
       and lower(coalesce(origen_cuenta, '')) like '%transferencias%');

-- 2) Insertar la fila faltante desde import_rows (solo si no existe)
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
  ir.dedupe_hash,
  b.created_by,
  coalesce(ir.normalized_json->>'category_name', ''),
  null,
  'operativo'
from public.import_rows ir
join public.import_batches b on b.id = ir.batch_id
where ir.id = '3f0724e3-dd1a-4139-bba4-1f65c005b5b6'::uuid
  and not exists (
    select 1
    from public.transactions t
    where t.organization_id = b.organization_id
      and t.dedupe_hash = ir.dedupe_hash
  );

-- 3) Confirmar
select source_id, date, amount, description, origen_cuenta
from public.transactions
where source_id in ('135691070603', '135691070604');
