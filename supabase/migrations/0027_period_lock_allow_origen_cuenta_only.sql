-- Permite actualizar solo origen_cuenta en períodos cerrados (etiquetas de maestro, sin tocar hechos).

create or replace function public.transactions_block_if_import_period_locked()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  org uuid;
  d date;
  d_new date;
  locked boolean;
begin
  if tg_op = 'INSERT' then
    org := new.organization_id;
    d := new.date;
    select exists (
      select 1
      from public.import_period_locks l
      where l.organization_id = org
        and d >= l.period_start
        and d < l.period_end_excl
    ) into locked;
    if locked then
      raise exception 'Período cerrado: no se permiten cambios en movimientos con fecha %.', d
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    org := old.organization_id;
    d := old.date;
    select exists (
      select 1
      from public.import_period_locks l
      where l.organization_id = org
        and d >= l.period_start
        and d < l.period_end_excl
    ) into locked;
    if locked then
      raise exception 'Período cerrado: no se puede eliminar un movimiento con fecha %.', d
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.date is not distinct from new.date
      and old.amount is not distinct from new.amount
      and lower(trim(coalesce(old.type::text, ''))) is not distinct from lower(trim(coalesce(new.type::text, '')))
      and old.organization_id is not distinct from new.organization_id
      and old.origen_cuenta is distinct from new.origen_cuenta
    then
      return new;
    end if;

    org := coalesce(new.organization_id, old.organization_id);
    d := old.date;
    d_new := new.date;
    select exists (
      select 1
      from public.import_period_locks l
      where l.organization_id = org
        and (
          (d >= l.period_start and d < l.period_end_excl)
          or (d_new >= l.period_start and d_new < l.period_end_excl)
        )
    ) into locked;
    if locked then
      raise exception 'Período cerrado: no se permiten cambios en movimientos cuya fecha afecta un período cerrado.'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  return null;
end;
$$;
