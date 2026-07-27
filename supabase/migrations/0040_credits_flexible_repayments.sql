-- Créditos sin cuotas fijas: pagos parciales de monto variable (repaid_total).
-- total_installments = 0 indica modo flexible (ya permitido por el check >= 0).

alter table public.credits
  add column if not exists repaid_total numeric(14,2) not null default 0
    check (repaid_total >= 0);

comment on column public.credits.repaid_total is
  'Suma de pagos parciales cuando total_installments = 0 (sin plan de cuotas).';

comment on column public.credits.total_installments is
  'Cantidad de cuotas del plan. 0 = sin cuotas fijas (pagos parciales variables).';
