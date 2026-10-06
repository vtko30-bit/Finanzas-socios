-- Egresos de cartola ya vinculados a un crédito no deben contar como gasto operativo.

update public.transactions
set
  flow_kind = 'financiamiento',
  credit_component = coalesce(nullif(trim(credit_component), ''), 'cuota')
where credit_id is not null
  and flow_kind = 'operativo'
  and (
    lower(coalesce(source, '')) like 'excel_%'
    or lower(coalesce(credit_component, '')) = 'cuota'
  );

create or replace function public.dashboard_metrics(
  p_org_id uuid,
  p_month_start date,
  p_month_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'month', (
      select jsonb_build_object(
        'income', coalesce(sum(case when type = 'income' then amount::numeric else 0 end), 0),
        'expense', coalesce(sum(case when type <> 'income' then amount::numeric else 0 end), 0),
        'count', count(*)::bigint
      )
      from transactions
      where organization_id = p_org_id
        and flow_kind = 'operativo'
        and (credit_id is null or source = 'creditos')
        and date >= p_month_start
        and date <= p_month_end
    ),
    'total', (
      select jsonb_build_object(
        'income', coalesce(sum(case when type = 'income' then amount::numeric else 0 end), 0),
        'expense', coalesce(sum(case when type <> 'income' then amount::numeric else 0 end), 0),
        'count', count(*)::bigint
      )
      from transactions
      where organization_id = p_org_id
        and flow_kind = 'operativo'
        and (credit_id is null or source = 'creditos')
    )
  );
$$;
