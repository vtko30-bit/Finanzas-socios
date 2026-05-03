-- Bloqueo de períodos para importación: al cerrar un mes o año, no se aceptan
-- movimientos nuevos con fecha en ese rango hasta que se elimine el bloqueo.

create table if not exists public.import_period_locks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end_excl date not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint import_period_locks_range_chk check (period_start < period_end_excl)
);

create unique index if not exists import_period_locks_org_range_uniq
  on public.import_period_locks (organization_id, period_start, period_end_excl);

create index if not exists import_period_locks_org_start
  on public.import_period_locks (organization_id, period_start);

alter table public.import_period_locks enable row level security;

create policy "members_select_import_period_locks" on public.import_period_locks
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "owners_insert_import_period_locks" on public.import_period_locks
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "owners_delete_import_period_locks" on public.import_period_locks
for delete
to authenticated
using (public.is_org_owner(organization_id));
