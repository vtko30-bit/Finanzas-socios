drop policy if exists "members_can_insert_memberships" on public.organization_members;

create policy "authenticated_can_insert_organizations" on public.organizations
for insert
to authenticated
with check (created_by = auth.uid());

create policy "owner_bootstrap_membership" on public.organization_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'owner'
  and status = 'active'
  and exists (
    select 1
    from public.organizations o
    where o.id = organization_id
      and o.created_by = auth.uid()
  )
);

create policy "members_can_insert_memberships" on public.organization_members
for insert
to authenticated
with check (public.is_org_member(organization_id));
