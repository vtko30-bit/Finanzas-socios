-- Escritura (insert/update/delete) solo para miembros con rol owner.
-- Lectura sigue disponible para todos los miembros activos (is_org_member).

create or replace function public.is_org_owner(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'owner'
  );
$$;

-- organization_members: solo owners agregan filas (invitaciones); el bootstrap sigue en owner_bootstrap_membership.
drop policy if exists "members_can_insert_memberships" on public.organization_members;

create policy "owners_can_insert_memberships" on public.organization_members
for insert
to authenticated
with check (public.is_org_owner(organization_id));

-- transactions
drop policy if exists "members_rw_transactions" on public.transactions;

create policy "members_select_transactions" on public.transactions
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "members_insert_transactions" on public.transactions
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "members_update_transactions" on public.transactions
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "members_delete_transactions" on public.transactions
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- import_batches
drop policy if exists "members_rw_import_batches" on public.import_batches;

create policy "members_select_import_batches" on public.import_batches
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "members_insert_import_batches" on public.import_batches
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "members_update_import_batches" on public.import_batches
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "members_delete_import_batches" on public.import_batches
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- import_rows
drop policy if exists "members_select_import_rows" on public.import_rows;
drop policy if exists "members_insert_import_rows" on public.import_rows;
drop policy if exists "members_delete_import_rows" on public.import_rows;

create policy "members_select_import_rows" on public.import_rows
for select
to authenticated
using (
  exists(
    select 1
    from public.import_batches b
    where b.id = import_rows.batch_id
      and public.is_org_member(b.organization_id)
  )
);

create policy "members_insert_import_rows" on public.import_rows
for insert
to authenticated
with check (
  exists(
    select 1
    from public.import_batches b
    where b.id = import_rows.batch_id
      and public.is_org_owner(b.organization_id)
  )
);

create policy "members_delete_import_rows" on public.import_rows
for delete
to authenticated
using (
  exists(
    select 1
    from public.import_batches b
    where b.id = import_rows.batch_id
      and public.is_org_owner(b.organization_id)
  )
);

-- concept_families
drop policy if exists "members_rw_concept_families" on public.concept_families;

create policy "members_select_concept_families" on public.concept_families
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "members_insert_concept_families" on public.concept_families
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "members_update_concept_families" on public.concept_families
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "members_delete_concept_families" on public.concept_families
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- concept_catalog
drop policy if exists "members_rw_concept_catalog" on public.concept_catalog;

create policy "members_select_concept_catalog" on public.concept_catalog
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "members_insert_concept_catalog" on public.concept_catalog
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "members_update_concept_catalog" on public.concept_catalog
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "members_delete_concept_catalog" on public.concept_catalog
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- accounts (legacy)
drop policy if exists "members_rw_accounts" on public.accounts;

create policy "members_select_accounts" on public.accounts
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "members_insert_accounts" on public.accounts
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "members_update_accounts" on public.accounts
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "members_delete_accounts" on public.accounts
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- categories (legacy)
drop policy if exists "members_rw_categories" on public.categories;

create policy "members_select_categories" on public.categories
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "members_insert_categories" on public.categories
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "members_update_categories" on public.categories
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "members_delete_categories" on public.categories
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- audit_log
drop policy if exists "members_rw_audit" on public.audit_log;

create policy "members_select_audit" on public.audit_log
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "members_insert_audit" on public.audit_log
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "members_update_audit" on public.audit_log
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "members_delete_audit" on public.audit_log
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- report_exports
drop policy if exists "members_rw_exports" on public.report_exports;

create policy "members_select_exports" on public.report_exports
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "members_insert_exports" on public.report_exports
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "members_update_exports" on public.report_exports
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "members_delete_exports" on public.report_exports
for delete
to authenticated
using (public.is_org_owner(organization_id));
