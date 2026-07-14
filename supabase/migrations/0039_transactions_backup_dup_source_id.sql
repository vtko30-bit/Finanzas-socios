-- Respaldo de egresos borrados por limpieza de duplicados (Id Origen / source_id).
-- Misma forma que transactions; PK propia en backup_id para permitir
-- múltiples limpiezas sin chocar si se reinserta el mismo id en el futuro.

create table if not exists public.transactions_backup_dup_source_id_egresos (
  backup_id uuid primary key default gen_random_uuid(),
  backed_up_at timestamptz not null default now(),
  id uuid not null,
  organization_id uuid not null,
  account_id uuid,
  category_id uuid,
  date date not null,
  type text not null,
  amount numeric(14,2) not null,
  currency text not null default 'CLP',
  description text not null default '',
  counterparty text not null default '',
  payment_method text not null default '',
  external_ref text not null default '',
  source text not null default 'manual',
  import_batch_id uuid,
  dedupe_hash text not null,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  origen_cuenta text,
  concepto text,
  source_id text,
  concept_id uuid,
  credit_id uuid,
  credit_component text,
  loan_given_id uuid
);

create index if not exists idx_tx_backup_dup_source_org
  on public.transactions_backup_dup_source_id_egresos (organization_id, backed_up_at desc);

create index if not exists idx_tx_backup_dup_source_orig_id
  on public.transactions_backup_dup_source_id_egresos (id);

alter table public.transactions_backup_dup_source_id_egresos enable row level security;

drop policy if exists "owners_select_tx_backup_dup_source" on public.transactions_backup_dup_source_id_egresos;
drop policy if exists "owners_insert_tx_backup_dup_source" on public.transactions_backup_dup_source_id_egresos;

create policy "owners_select_tx_backup_dup_source"
  on public.transactions_backup_dup_source_id_egresos
  for select
  to authenticated
  using (public.is_org_owner(organization_id));

create policy "owners_insert_tx_backup_dup_source"
  on public.transactions_backup_dup_source_id_egresos
  for insert
  to authenticated
  with check (public.is_org_owner(organization_id));
