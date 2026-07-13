-- Limpieza de egresos duplicados por Id Origen (transactions.source_id).
-- 1) Sustituye ORG_ID.
-- 2) Ejecuta primero egresos-dup-por-id-origen-preview.sql y revisa.
-- 3) Corre este script en una transacción; confirma antes del COMMIT.
--
-- Conserva rn = 1 (preferencia: con categoría / vínculo crédito / más antigua).
-- Borra rn > 1 (típicamente la reimportación sin clasificar).

begin;

create table if not exists public.transactions_backup_dup_source_id_egresos as
select t.*
from public.transactions t
where false;

with ranked as (
  select
    t.id,
    row_number() over (
      partition by t.organization_id, upper(trim(t.source_id))
      order by
        (t.concept_id is null)::int,
        (t.credit_id is null)::int,
        (t.loan_given_id is null)::int,
        t.created_at asc,
        t.id asc
    ) as rn,
    count(*) over (
      partition by t.organization_id, upper(trim(t.source_id))
    ) as n
  from public.transactions t
  where t.organization_id = 'ORG_ID'::uuid
    and t.type = 'expense'
    and nullif(trim(t.source_id), '') is not null
),
to_delete as (
  select id from ranked where n > 1 and rn > 1
)
insert into public.transactions_backup_dup_source_id_egresos
select t.*
from public.transactions t
join to_delete d on d.id = t.id
where not exists (
  select 1
  from public.transactions_backup_dup_source_id_egresos b
  where b.id = t.id
);

with ranked as (
  select
    t.id,
    row_number() over (
      partition by t.organization_id, upper(trim(t.source_id))
      order by
        (t.concept_id is null)::int,
        (t.credit_id is null)::int,
        (t.loan_given_id is null)::int,
        t.created_at asc,
        t.id asc
    ) as rn,
    count(*) over (
      partition by t.organization_id, upper(trim(t.source_id))
    ) as n
  from public.transactions t
  where t.organization_id = 'ORG_ID'::uuid
    and t.type = 'expense'
    and nullif(trim(t.source_id), '') is not null
)
delete from public.transactions t
using ranked r
where t.id = r.id
  and r.n > 1
  and r.rn > 1;

-- Verifica conteo borrado / restante antes de commit:
-- select count(*) from public.transactions_backup_dup_source_id_egresos;
-- select source_id, count(*) from public.transactions
-- where organization_id = 'ORG_ID'::uuid and type = 'expense'
--   and nullif(trim(source_id), '') is not null
-- group by 1 having count(*) > 1;

-- commit;
-- rollback;
