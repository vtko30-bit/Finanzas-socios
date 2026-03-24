create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'socio', 'contador')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  account_type text not null check (account_type in ('bank', 'cash')),
  currency text not null default 'CLP',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  parent_id uuid references public.categories(id),
  created_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  filename text not null,
  status text not null check (status in ('uploaded', 'validated', 'imported', 'failed')),
  summary_json jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number int not null,
  raw_json jsonb not null default '{}'::jsonb,
  normalized_json jsonb not null default '{}'::jsonb,
  validation_errors_json jsonb not null default '[]'::jsonb,
  dedupe_hash text not null,
  status text not null default 'valid' check (status in ('valid', 'invalid', 'duplicate')),
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid references public.accounts(id),
  category_id uuid references public.categories(id),
  date date not null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'CLP',
  description text not null default '',
  counterparty text not null default '',
  payment_method text not null default '',
  external_ref text not null default '',
  source text not null default 'manual',
  import_batch_id uuid references public.import_batches(id),
  dedupe_hash text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_hash)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  changes_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.report_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  filters_json jsonb not null default '{}'::jsonb,
  file_path text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_members_user on public.organization_members(user_id);
create index if not exists idx_tx_org_date on public.transactions(organization_id, date);
create index if not exists idx_tx_org_type on public.transactions(organization_id, type);
create index if not exists idx_import_rows_batch on public.import_rows(batch_id);
create index if not exists idx_audit_org_date on public.audit_log(organization_id, created_at desc);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.transactions enable row level security;
alter table public.audit_log enable row level security;
alter table public.report_exports enable row level security;

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create policy "members_can_select_organizations" on public.organizations
for select using (public.is_org_member(id));

create policy "members_can_select_memberships" on public.organization_members
for select using (public.is_org_member(organization_id));

create policy "members_can_insert_memberships" on public.organization_members
for insert with check (public.is_org_member(organization_id));

create policy "members_rw_accounts" on public.accounts
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_rw_categories" on public.categories
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_rw_import_batches" on public.import_batches
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_rw_transactions" on public.transactions
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_rw_audit" on public.audit_log
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_rw_exports" on public.report_exports
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_select_import_rows" on public.import_rows
for select using (
  exists(
    select 1
    from public.import_batches b
    where b.id = import_rows.batch_id
      and public.is_org_member(b.organization_id)
  )
);

create policy "members_insert_import_rows" on public.import_rows
for insert with check (
  exists(
    select 1
    from public.import_batches b
    where b.id = import_rows.batch_id
      and public.is_org_member(b.organization_id)
  )
);
