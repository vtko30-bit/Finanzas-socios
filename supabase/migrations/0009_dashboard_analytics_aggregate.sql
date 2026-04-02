-- Agregaciones en base de datos para el panel y análisis (evita cargar todas las filas).

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
    )
  );
$$;

grant execute on function public.dashboard_metrics(uuid, date, date) to authenticated;

create or replace function public.analytics_monthly_totals(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'periodo', sub.periodo,
        'ingresos', sub.ingresos,
        'gastos', sub.gastos,
        'neto', sub.ingresos - sub.gastos
      ) ORDER BY sub.periodo
    ),
    '[]'::jsonb
  )
  from (
    select
      to_char(date, 'YYYY-MM') as periodo,
      coalesce(sum(case when type = 'income' then amount::numeric else 0 end), 0) as ingresos,
      coalesce(sum(case when type <> 'income' then amount::numeric else 0 end), 0) as gastos
    from transactions
    where organization_id = p_org_id
    group by to_char(date, 'YYYY-MM')
  ) sub;
$$;

grant execute on function public.analytics_monthly_totals(uuid) to authenticated;
