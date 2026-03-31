-- Normaliza tipos históricos de egresos a "expense".
-- Cubre variantes que pudieron quedar antes de estandarizar importaciones.
update public.transactions
set type = 'expense'
where lower(trim(type)) in ('gasto', 'egreso');
