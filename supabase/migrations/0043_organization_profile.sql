-- Datos de la empresa en organizations + actualización solo por owners.

alter table public.organizations
  add column if not exists rut text not null default '',
  add column if not exists giro text not null default '',
  add column if not exists address text not null default '',
  add column if not exists comuna text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists contact_email text not null default '',
  add column if not exists representative text not null default '',
  add column if not exists website text not null default '';

drop policy if exists "owners_can_update_organizations" on public.organizations;

create policy "owners_can_update_organizations" on public.organizations
for update
to authenticated
using (public.is_org_owner(id))
with check (public.is_org_owner(id));
