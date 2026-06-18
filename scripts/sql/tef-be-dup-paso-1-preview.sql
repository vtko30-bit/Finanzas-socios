-- Paso 1: PREVIEW — filas TEF que se borrarían (debe coincidir con tef_duplicados_en_bd).
select
  tef.id,
  tef.date,
  tef.amount,
  tef.external_ref,
  tef.origen_cuenta,
  tef.counterparty,
  left(tef.description, 60) as descripcion
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
  )
order by tef.date desc, tef.amount desc;
