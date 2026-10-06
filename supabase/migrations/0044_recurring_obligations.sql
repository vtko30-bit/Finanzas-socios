-- Pagos recurrentes / obligaciones mensuales (arriendo, servicios, etc.)

create table if not exists public.recurring_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  day_of_month int not null check (day_of_month >= 1 and day_of_month <= 31),
  amount_estimate numeric(14,2) check (amount_estimate is null or amount_estimate >= 0),
  family_id uuid references public.concept_families(id) on delete set null,
  match_text text not null default '',
  notes text not null default '',
  reminder_days_before int not null default 3 check (reminder_days_before >= 0 and reminder_days_before <= 30),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recurring_obligations_org
  on public.recurring_obligations(organization_id, active, sort_order);

create table if not exists public.recurring_obligation_marks (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.recurring_obligations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  year int not null check (year >= 2000 and year <= 2100),
  month int not null check (month >= 1 and month <= 12),
  marked_paid boolean not null default true,
  marked_by uuid,
  marked_at timestamptz not null default now(),
  unique (obligation_id, year, month)
);

create index if not exists idx_recurring_obligation_marks_org_period
  on public.recurring_obligation_marks(organization_id, year, month);

alter table public.recurring_obligations enable row level security;
alter table public.recurring_obligation_marks enable row level security;

create policy "members_rw_recurring_obligations" on public.recurring_obligations
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_rw_recurring_obligation_marks" on public.recurring_obligation_marks
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

notify pgrst, 'reload schema';
