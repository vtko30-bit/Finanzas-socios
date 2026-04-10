-- Exclusión del resumen/detalle por familia de conceptos (concept_families), no por categoría.

drop table if exists public.org_excluded_categories;

create table if not exists public.org_excluded_families (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  family_id uuid not null references public.concept_families(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, family_id)
);

create index if not exists idx_org_excluded_families_org
  on public.org_excluded_families (organization_id);

alter table public.org_excluded_families enable row level security;

create policy "members_select_org_excluded_families"
  on public.org_excluded_families
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "owners_insert_org_excluded_families"
  on public.org_excluded_families
  for insert
  to authenticated
  with check (public.is_org_owner(organization_id));

create policy "owners_delete_org_excluded_families"
  on public.org_excluded_families
  for delete
  to authenticated
  using (public.is_org_owner(organization_id));
