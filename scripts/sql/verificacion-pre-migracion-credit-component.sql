-- Verificación previa para proteger datos antes de aplicar la migración 0015.
-- Si esta consulta retorna filas, debes normalizar esos valores antes de migrar.

select
  credit_component,
  count(*) as total
from public.transactions
where credit_component is not null
  and credit_component not in (
    'desembolso',
    'pago_capital',
    'pago_interes',
    'comision',
    'cuota',
    'prestamo_otorgado',
    'prestamo_otorgado_conciliado',
    'recupero_prestamo'
  )
group by credit_component
order by total desc;
