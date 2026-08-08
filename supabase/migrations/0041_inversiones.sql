-- Inversiones financieras (FFMM, DAP, ETF): mueven caja sin entrar al P&L operativo.

alter table public.transactions
  drop constraint if exists transactions_flow_kind_check;

alter table public.transactions
  add constraint transactions_flow_kind_check
  check (flow_kind in ('operativo', 'financiamiento', 'inversion'));

create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('ffmm', 'dap', 'etf')),
  institution text not null default '',
  currency text not null default 'CLP',
  notes text not null default '',
  contributed_total numeric(14, 2) not null default 0 check (contributed_total >= 0),
  redeemed_total numeric(14, 2) not null default 0 check (redeemed_total >= 0),
  yield_total numeric(14, 2) not null default 0,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_investments_org_created
  on public.investments (organization_id, created_at desc);

alter table public.transactions
  add column if not exists investment_id uuid references public.investments(id) on delete set null;

alter table public.transactions
  add column if not exists investment_component text;

alter table public.transactions
  drop constraint if exists transactions_investment_component_check;

alter table public.transactions
  add constraint transactions_investment_component_check
  check (
    investment_component is null
    or investment_component in ('aporte', 'rescate', 'rendimiento')
  );

create index if not exists idx_transactions_investment_id
  on public.transactions (investment_id);

alter table public.investments enable row level security;

drop policy if exists "members_rw_investments" on public.investments;
create policy "members_rw_investments" on public.investments
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
