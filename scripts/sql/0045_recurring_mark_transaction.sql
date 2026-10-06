-- Asociar marca de pago recurrente a un movimiento (como cuotas de crédito).

alter table public.recurring_obligation_marks
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

create unique index if not exists uq_recurring_obligation_marks_transaction
  on public.recurring_obligation_marks(transaction_id)
  where transaction_id is not null;

create index if not exists idx_recurring_obligation_marks_transaction
  on public.recurring_obligation_marks(transaction_id)
  where transaction_id is not null;

notify pgrst, 'reload schema';
