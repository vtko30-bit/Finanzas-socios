-- Grupos de egresos que parecen duplicados (misma fecha, monto, origen y
-- beneficiario) pero el dueño confirmó que son pagos distintos. No vuelven
-- a la revisión salvo que aparezca un movimiento nuevo en el mismo grupo.

create table if not exists public.expense_duplicate_acks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fingerprint text not null,
  transaction_ids uuid[] not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (organization_id, fingerprint),
  constraint expense_duplicate_acks_min_two
    check (cardinality(transaction_ids) >= 2)
);

create index if not exists idx_expense_duplicate_acks_org
  on public.expense_duplicate_acks(organization_id);

alter table public.expense_duplicate_acks enable row level security;

drop policy if exists "owners_select_expense_duplicate_acks" on public.expense_duplicate_acks;
create policy "owners_select_expense_duplicate_acks" on public.expense_duplicate_acks
for select
to authenticated
using (public.is_org_owner(organization_id));

drop policy if exists "owners_insert_expense_duplicate_acks" on public.expense_duplicate_acks;
create policy "owners_insert_expense_duplicate_acks" on public.expense_duplicate_acks
for insert
to authenticated
with check (public.is_org_owner(organization_id));

drop policy if exists "owners_delete_expense_duplicate_acks" on public.expense_duplicate_acks;
create policy "owners_delete_expense_duplicate_acks" on public.expense_duplicate_acks
for delete
to authenticated
using (public.is_org_owner(organization_id));

notify pgrst, 'reload schema';
