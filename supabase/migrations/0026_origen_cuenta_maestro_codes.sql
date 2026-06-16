-- Etiqueta códigos cortos de maestro en origen_cuenta (solo filas sin etiqueta previa).
-- Desactiva el guard de período cerrado: solo cambia etiqueta, no fecha/monto.

alter table public.transactions disable trigger transactions_import_period_lock_guard;

update public.transactions t
set origen_cuenta = trim(t.origen_cuenta) || ' · trans_be'
where lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos'
  and lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%transferencias%'
  and (
    lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%banco%'
    or lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%bestado%'
    or lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%estado%'
  )
  and not (coalesce(t.origen_cuenta::text, '') like '% · %')
  and not (lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%bci%')
  and not (lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%chile%');

update public.transactions t
set origen_cuenta = trim(t.origen_cuenta) || ' · trans_cl'
where lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos'
  and lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%transferencias%'
  and (
    lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%bci%'
    or lower(trim(coalesce(t.origen_cuenta::text, ''))) like '%chile%'
  )
  and not (coalesce(t.origen_cuenta::text, '') like '% · %');

update public.transactions t
set origen_cuenta = trim(t.origen_cuenta) || ' · mov_be'
where lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos'
  and trim(coalesce(t.origen_cuenta::text, '')) = 'Rg'
  and not (coalesce(t.origen_cuenta::text, '') like '% · %');

update public.transactions t
set origen_cuenta = trim(t.origen_cuenta) || ' · mov_bci'
where lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos'
  and trim(coalesce(t.origen_cuenta::text, '')) = 'Happy'
  and not (coalesce(t.origen_cuenta::text, '') like '% · %');

update public.transactions t
set origen_cuenta = trim(t.origen_cuenta) || ' · ing_be'
where lower(trim(coalesce(t.source::text, ''))) = 'excel_otros_ingresos'
  and trim(coalesce(t.origen_cuenta::text, '')) = 'Banco Estado'
  and not (coalesce(t.origen_cuenta::text, '') like '% · %');

update public.transactions t
set origen_cuenta = trim(t.origen_cuenta) || ' · ing_bci'
where lower(trim(coalesce(t.source::text, ''))) = 'excel_otros_ingresos'
  and trim(coalesce(t.origen_cuenta::text, '')) = 'Bci'
  and not (coalesce(t.origen_cuenta::text, '') like '% · %');

update public.transactions t
set origen_cuenta = trim(t.origen_cuenta) || ' · pago_be'
where lower(trim(coalesce(t.source::text, ''))) = 'excel_egresos_banco_estado_servicios'
  and not (coalesce(t.origen_cuenta::text, '') like '% · %');

alter table public.transactions enable trigger transactions_import_period_lock_guard;
