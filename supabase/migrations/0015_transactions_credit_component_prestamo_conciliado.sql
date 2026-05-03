-- Permite marcar desembolsos de préstamos otorgados conciliados (total o parcial).
-- Migración defensiva: no borra registros y falla con mensaje claro si existe data inválida.

begin;

alter table public.transactions
  drop constraint if exists transactions_credit_component_check;

alter table public.transactions
  add constraint transactions_credit_component_check
  check (
    credit_component is null
    or credit_component in (
      'desembolso',
      'pago_capital',
      'pago_interes',
      'comision',
      'cuota',
      'prestamo_otorgado',
      'prestamo_otorgado_conciliado',
      'recupero_prestamo'
    )
  ) not valid;

do $$
begin
  if exists (
    select 1
    from public.transactions t
    where t.credit_component is not null
      and t.credit_component not in (
        'desembolso',
        'pago_capital',
        'pago_interes',
        'comision',
        'cuota',
        'prestamo_otorgado',
        'prestamo_otorgado_conciliado',
        'recupero_prestamo'
      )
  ) then
    raise exception using
      message = 'La migración se detuvo: existen valores de credit_component fuera del catálogo permitido.',
      hint = 'Corrige esos valores primero para continuar; no se eliminó ningún dato.';
  end if;
end;
$$;

alter table public.transactions
  validate constraint transactions_credit_component_check;

commit;
