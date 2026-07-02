-- Posición bancaria manual (saldos por banco/cuenta en inicio).

create table if not exists public.bank_position_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_date date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, snapshot_date)
);

create table if not exists public.bank_position_lines (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.bank_position_snapshots(id) on delete cascade,
  banco text not null,
  ahorro numeric not null default 0,
  efectivo numeric not null default 0,
  total numeric not null default 0,
  sort_order int not null default 0,
  unique (snapshot_id, banco)
);

create index if not exists bank_position_snapshots_org_date_idx
  on public.bank_position_snapshots (organization_id, snapshot_date desc);

create index if not exists bank_position_lines_snapshot_idx
  on public.bank_position_lines (snapshot_id, sort_order);

alter table public.bank_position_snapshots enable row level security;
alter table public.bank_position_lines enable row level security;

create policy "members_select_bank_position_snapshots"
  on public.bank_position_snapshots for select to authenticated
  using (public.is_org_member(organization_id));

create policy "owners_insert_bank_position_snapshots"
  on public.bank_position_snapshots for insert to authenticated
  with check (public.is_org_owner(organization_id));

create policy "owners_update_bank_position_snapshots"
  on public.bank_position_snapshots for update to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

create policy "owners_delete_bank_position_snapshots"
  on public.bank_position_snapshots for delete to authenticated
  using (public.is_org_owner(organization_id));

create policy "members_select_bank_position_lines"
  on public.bank_position_lines for select to authenticated
  using (
    exists (
      select 1 from public.bank_position_snapshots s
      where s.id = snapshot_id and public.is_org_member(s.organization_id)
    )
  );

create policy "owners_insert_bank_position_lines"
  on public.bank_position_lines for insert to authenticated
  with check (
    exists (
      select 1 from public.bank_position_snapshots s
      where s.id = snapshot_id and public.is_org_owner(s.organization_id)
    )
  );

create policy "owners_update_bank_position_lines"
  on public.bank_position_lines for update to authenticated
  using (
    exists (
      select 1 from public.bank_position_snapshots s
      where s.id = snapshot_id and public.is_org_owner(s.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.bank_position_snapshots s
      where s.id = snapshot_id and public.is_org_owner(s.organization_id)
    )
  );

create policy "owners_delete_bank_position_lines"
  on public.bank_position_lines for delete to authenticated
  using (
    exists (
      select 1 from public.bank_position_snapshots s
      where s.id = snapshot_id and public.is_org_owner(s.organization_id)
    )
  );
