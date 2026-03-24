alter table public.transactions
  add column if not exists origen_cuenta text not null default '';

alter table public.transactions
  add column if not exists concepto text not null default '';
