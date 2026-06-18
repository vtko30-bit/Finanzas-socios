-- Paso 3: verificar que no queden duplicados en BD.
select count(*) as tef_duplicados_en_bd
from public.transactions tef
where upper(trim(coalesce(tef.description::text, ''))) like 'TEF%'
  and lower(trim(coalesce(tef.origen_cuenta::text, ''))) not like '%transferencias%'
  and nullif(trim(coalesce(tef.external_ref::text, '')), '') is not null
  and exists (
    select 1
    from public.transactions t2
    where t2.organization_id = tef.organization_id
      and t2.id <> tef.id
      and trim(coalesce(t2.external_ref::text, '')) = trim(coalesce(tef.external_ref::text, ''))
      and round(abs(t2.amount::numeric), 2) = round(abs(tef.amount::numeric), 2)
      and upper(trim(coalesce(t2.description::text, ''))) not like 'TEF%'
  );

select count(*) as filas_en_backup
from public.transactions_backup_tef_be_op_amt_20260617;
