-- Saldo en cuenta corriente por línea de posición bancaria.

alter table public.bank_position_lines
  add column if not exists saldo_cta_cte numeric not null default 0;
