-- Familias de concepto (ej: Remuneración) y conceptos del catálogo (ej: Anticipo remuneración).

create table if not exists public.concept_families (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.concept_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  family_id uuid not null references public.concept_families(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, label)
);

create index if not exists idx_concept_catalog_family on public.concept_catalog(family_id);
create index if not exists idx_concept_catalog_org on public.concept_catalog(organization_id);

alter table public.transactions
  add column if not exists concept_id uuid references public.concept_catalog(id) on delete set null;

create index if not exists idx_transactions_concept_id on public.transactions(concept_id);

alter table public.concept_families enable row level security;
alter table public.concept_catalog enable row level security;

create policy "members_rw_concept_families" on public.concept_families
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members_rw_concept_catalog" on public.concept_catalog
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
