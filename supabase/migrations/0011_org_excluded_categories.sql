-- Categorías (etiqueta mostrada en detalle) excluidas del resumen y del detalle principal.

create table if not exists public.org_excluded_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label_key text not null,
  label_display text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, label_key)
);

create index if not exists idx_org_excluded_categories_org
  on public.org_excluded_categories (organization_id);

alter table public.org_excluded_categories enable row level security;

create policy "members_select_org_excluded_categories"
  on public.org_excluded_categories
  for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "owners_insert_org_excluded_categories"
  on public.org_excluded_categories
  for insert
  to authenticated
  with check (public.is_org_owner(organization_id));

create policy "owners_delete_org_excluded_categories"
  on public.org_excluded_categories
  for delete
  to authenticated
  using (public.is_org_owner(organization_id));
