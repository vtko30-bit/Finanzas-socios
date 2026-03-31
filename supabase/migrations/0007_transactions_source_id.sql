alter table public.transactions
  add column if not exists source_id text not null default '';
