-- Soporte para créditos: desembolso, cuotas y separación operativo/financiamiento.

alter table public.transactions
  add column if not exists flow_kind text;

update public.transactions
set flow_kind = 'operativo'
where flow_kind is null;

alter table public.transactions
  alter column flow_kind set default 'operativo';

alter table public.transactions
  alter column flow_kind set not null;

alter table public.transactions
  drop constraint if exists transactions_flow_kind_check;

alter table public.transactions
  add constraint transactions_flow_kind_check
  check (flow_kind in ('operativo', 'financiamiento'));

create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lender text not null default '',
  description text not null default '',
  principal numeric(14,2) not null check (principal > 0),
  currency text not null default 'CLP',
  disbursement_date date not null,
  total_installments int not null default 0 check (total_installments >= 0),
  installment_amount numeric(14,2) not null default 0 check (installment_amount >= 0),
  status text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_installments (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.credits(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  installment_number int not null check (installment_number > 0),
  due_date date not null,
  principal_amount numeric(14,2) not null default 0 check (principal_amount >= 0),
  interest_amount numeric(14,2) not null default 0 check (interest_amount >= 0),
  fee_amount numeric(14,2) not null default 0 check (fee_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  paid_at date,
  status text not null default 'pending' check (status in ('pending', 'partial', 'paid')),
  created_at timestamptz not null default now(),
  unique (credit_id, installment_number)
);

alter table public.transactions
  add column if not exists credit_id uuid references public.credits(id) on delete set null;

alter table public.transactions
  add column if not exists credit_component text;

alter table public.transactions
  drop constraint if exists transactions_credit_component_check;

alter table public.transactions
  add constraint transactions_credit_component_check
  check (
    credit_component is null
    or credit_component in ('desembolso', 'pago_capital', 'pago_interes', 'comision', 'cuota')
  );

create index if not exists idx_transactions_flow_kind on public.transactions(organization_id, flow_kind);
create index if not exists idx_transactions_credit_id on public.transactions(credit_id);
create index if not exists idx_credits_org_created on public.credits(organization_id, created_at desc);
create index if not exists idx_credit_installments_credit_due on public.credit_installments(credit_id, due_date);

alter table public.credits enable row level security;
alter table public.credit_installments enable row level security;

create policy "members_rw_credits" on public.credits
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_rw_credit_installments" on public.credit_installments
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

-- Ajusta agregaciones de panel y análisis para excluir financiamiento.
create or replace function public.dashboard_metrics(
  p_org_id uuid,
  p_month_start date,
  p_month_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'month', (
      select jsonb_build_object(
        'income', coalesce(sum(case when type = 'income' then amount::numeric else 0 end), 0),
        'expense', coalesce(sum(case when type <> 'income' then amount::numeric else 0 end), 0),
        'count', count(*)::bigint
      )
      from transactions
      where organization_id = p_org_id
        and flow_kind = 'operativo'
        and date >= p_month_start
        and date <= p_month_end
    ),
    'total', (
      select jsonb_build_object(
        'income', coalesce(sum(case when type = 'income' then amount::numeric else 0 end), 0),
        'expense', coalesce(sum(case when type <> 'income' then amount::numeric else 0 end), 0),
        'count', count(*)::bigint
      )
      from transactions
      where organization_id = p_org_id
        and flow_kind = 'operativo'
    )
  );
$$;

grant execute on function public.dashboard_metrics(uuid, date, date) to authenticated;

create or replace function public.analytics_monthly_totals(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'periodo', sub.periodo,
        'ingresos', sub.ingresos,
        'gastos', sub.gastos,
        'neto', sub.ingresos - sub.gastos
      ) ORDER BY sub.periodo
    ),
    '[]'::jsonb
  )
  from (
    select
      to_char(date, 'YYYY-MM') as periodo,
      coalesce(sum(case when type = 'income' then amount::numeric else 0 end), 0) as ingresos,
      coalesce(sum(case when type <> 'income' then amount::numeric else 0 end), 0) as gastos
    from transactions
    where organization_id = p_org_id
      and flow_kind = 'operativo'
    group by to_char(date, 'YYYY-MM')
  ) sub;
$$;

grant execute on function public.analytics_monthly_totals(uuid) to authenticated;
