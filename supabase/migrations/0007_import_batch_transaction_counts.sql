-- Agregación de movimientos por lote de importación (evita traer todas las filas al servidor).

create or replace function public.import_batch_transaction_counts(p_org_id uuid)
returns table (import_batch_id uuid, income_count bigint, expense_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.import_batch_id,
    count(*) filter (where t.type = 'income')::bigint,
    count(*) filter (where t.type = 'expense')::bigint
  from public.transactions t
  where t.organization_id = p_org_id
    and t.import_batch_id is not null
  group by t.import_batch_id;
$$;

grant execute on function public.import_batch_transaction_counts(uuid) to authenticated;
