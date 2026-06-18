-- Paso 2: respaldo + borrado de cartolas TEF duplicadas (mismo N° op. + monto que fila no-TEF).
-- Ejecutar solo después de revisar el paso 1.

create table if not exists public.transactions_backup_tef_be_op_amt_20260617
(like public.transactions including all);

insert into public.transactions_backup_tef_be_op_amt_20260617
select tef.*
from public.transactions tef
where upper(trim(coalesce(tef.description::text, ''))) like 'TEF%'
  and lower(trim(coalesce(tef.origen_cuenta::text, ''))) not like '%transferencias%'
  and nullif(trim(coalesce(tef.external_ref::text, '')), '') is not null
  and not exists (
    select 1
    from public.transactions_backup_tef_be_op_amt_20260617 b
    where b.id = tef.id
  )
  and exists (
    select 1
    from public.transactions t2
    where t2.organization_id = tef.organization_id
      and t2.id <> tef.id
      and trim(coalesce(t2.external_ref::text, '')) = trim(coalesce(tef.external_ref::text, ''))
      and round(abs(t2.amount::numeric), 2) = round(abs(tef.amount::numeric), 2)
      and upper(trim(coalesce(t2.description::text, ''))) not like 'TEF%'
  );

delete from public.transactions tef
where tef.id in (
  select b.id from public.transactions_backup_tef_be_op_amt_20260617 b
);
