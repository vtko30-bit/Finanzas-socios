-- Resuelve qué dedupe_hash ya existen en una sola llamada (body JSON),
-- evitando cientos de requests .in() con URL acotada.

create or replace function public.existing_dedupe_hashes_for_org(
  p_organization_id uuid,
  p_hashes text[]
)
returns table (dedupe_hash text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct t.dedupe_hash
  from public.transactions t
  where t.organization_id = p_organization_id
    and t.dedupe_hash = any (p_hashes);
$$;

grant execute on function public.existing_dedupe_hashes_for_org(uuid, text[]) to authenticated;
