-- Reconoce más orígenes BE (p. ej. Transferencias Rg) y alinea dedupe TEF con fecha+monto.

create or replace function public.origen_familia_banco_dedupe(p_origen text)
returns text
language sql
immutable
as $$
  with n as (
    select lower(regexp_replace(
      translate(
        coalesce(trim(p_origen), ''),
        'áéíóúüñÁÉÍÓÚÜÑ',
        'aeiouunaeiouun'
      ),
      '[^a-z0-9]', '', 'g'
    )) as k
  )
  select case
    when k = '' then null
    when k like '%transferencias%' or k like '%transferencia%' then case
      when k like '%bci%' then 'bci'
      when k like '%chile%' or k like '%bancodechile%' then 'bdch'
      when k like '%banco%' or k like '%bestado%' or k like '%estado%' or k like '%rg' then 'be'
      else null
    end
    when k like '%bci%' then 'bci'
    when k like '%chile%' or k like '%bancodechile%' then 'bdch'
    when k = 'rg' or k like 'rg%' or k like '%rg' or k like '%bancoestado%' or k like '%bestado%' then 'be'
    when k = 'happy' or k like 'happy%' then 'bci'
    else null
  end
  from n;
$$;
