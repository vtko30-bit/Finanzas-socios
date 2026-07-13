-- Preview de egresos duplicados por Id Origen (transactions.source_id).
-- Sustituye ORG_ID por el uuid de tu organización.
--
-- Criterio de negocio: mismo organization_id + type=expense + source_id no vacío.
-- (Como en tu ejemplo: Id Origen 135691070683 aparece en 2 lotes.)
--
-- Conservación propuesta (rn = 1):
--   1) con concept_id (categoría asignada)
--   2) con credit_id / loan_given_id
--   3) la más antigua (created_at)
-- Las filas con rn > 1 son candidatas a borrar.

with base as (
  select
    t.id,
    t.date,
    t.amount,
    t.source_id,
    t.external_ref,
    t.origen_cuenta,
    t.counterparty,
    t.description,
    t.concepto,
    t.concept_id,
    t.credit_id,
    t.loan_given_id,
    t.import_batch_id,
    t.source,
    t.created_at,
    count(*) over (
      partition by t.organization_id, upper(trim(t.source_id))
    ) as n,
    row_number() over (
      partition by t.organization_id, upper(trim(t.source_id))
      order by
        (t.concept_id is null)::int,
        (t.credit_id is null)::int,
        (t.loan_given_id is null)::int,
        t.created_at asc,
        t.id asc
    ) as rn
  from public.transactions t
  where t.organization_id = 'ORG_ID'::uuid
    and t.type = 'expense'
    and nullif(trim(t.source_id), '') is not null
)
select
  rn,
  n,
  id,
  date,
  amount,
  source_id as id_origen,
  external_ref as nro_operacion,
  origen_cuenta,
  counterparty as nombre_destino,
  left(coalesce(description, ''), 80) as descripcion,
  concepto,
  concept_id is not null as tiene_categoria,
  import_batch_id,
  source,
  created_at
from base
where n > 1
order by source_id, rn, created_at;
