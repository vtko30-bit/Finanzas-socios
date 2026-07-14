-- Limpieza de egresos duplicados por Id Origen (transactions.source_id).
-- Pensado para el SQL Editor de Supabase (autocommit: NO uses BEGIN/COMMIT).
--
-- Caso típico: reimportaste porque el lote viejo estaba INCOMPLETO.
-- - Conserva la fila clasificada (casi siempre la del lote viejo).
-- - Conserva las filas del lote nuevo que NO existían (completan el archivo).
-- - Borra solo los pares con el mismo Id Origen.
--
-- 1) Ejecuta egresos-dup-por-id-origen-preview.sql y revisa.
-- 2) Ejecuta este script completo de una vez.
-- 3) Vuelve a correr el preview: debe devolver 0 filas.

-- A) Backup de lo que se va a borrar (idempotente)
create table if not exists public.transactions_backup_dup_source_id_egresos as
select t.*
from public.transactions t
where false;

insert into public.transactions_backup_dup_source_id_egresos
select t.*
from public.transactions t
join (
  select
    t2.id,
    row_number() over (
      partition by t2.organization_id, upper(trim(t2.source_id))
      order by
        (t2.concept_id is null)::int,
        (t2.credit_id is null)::int,
        (t2.loan_given_id is null)::int,
        t2.created_at asc,
        t2.id asc
    ) as rn,
    count(*) over (
      partition by t2.organization_id, upper(trim(t2.source_id))
    ) as n
  from public.transactions t2
  where t2.type = 'expense'
    and nullif(trim(t2.source_id), '') is not null
) ranked on ranked.id = t.id
where ranked.n > 1
  and ranked.rn > 1
  and not exists (
    select 1
    from public.transactions_backup_dup_source_id_egresos b
    where b.id = t.id
  );

-- B) Borrado efectivo
delete from public.transactions t
using (
  select
    t2.id,
    row_number() over (
      partition by t2.organization_id, upper(trim(t2.source_id))
      order by
        (t2.concept_id is null)::int,
        (t2.credit_id is null)::int,
        (t2.loan_given_id is null)::int,
        t2.created_at asc,
        t2.id asc
    ) as rn,
    count(*) over (
      partition by t2.organization_id, upper(trim(t2.source_id))
    ) as n
  from public.transactions t2
  where t2.type = 'expense'
    and nullif(trim(t2.source_id), '') is not null
) ranked
where t.id = ranked.id
  and ranked.n > 1
  and ranked.rn > 1;

-- C) Verificación rápida (debe devolver 0 filas en el segundo select)
-- select count(*) as respaldados from public.transactions_backup_dup_source_id_egresos;
--
-- select upper(trim(source_id)) as id_origen, count(*) as n
-- from public.transactions
-- where type = 'expense' and nullif(trim(source_id), '') is not null
-- group by 1
-- having count(*) > 1;
