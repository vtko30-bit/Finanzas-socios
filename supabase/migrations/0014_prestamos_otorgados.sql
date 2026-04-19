-- Préstamos otorgados a terceros (sin cuotas fijas ni interés obligatorio).

create table if not exists public.loans_given (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  borrower text not null default '',
  description text not null default '',
  principal numeric(14,2) not null check (principal > 0),
  repaid_total numeric(14,2) not null default 0 check (repaid_total >= 0),
  currency text not null default 'CLP',
  disbursement_date date not null,
  status text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_loans_given_org_created on public.loans_given(organization_id, created_at desc);

alter table public.transactions
  add column if not exists loan_given_id uuid references public.loans_given(id) on delete set null;

create index if not exists idx_transactions_loan_given_id on public.transactions(loan_given_id);

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
      'recupero_prestamo'
    )
  );

alter table public.loans_given enable row level security;

create policy "members_rw_loans_given" on public.loans_given
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
