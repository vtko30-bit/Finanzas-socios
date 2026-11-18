"use client";

/** Abreviaturas cortas para la casilla cerrada. */
export const MESES_ABR = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sept",
  "Oct",
  "Nov",
  "Dic",
] as const;

function parseYearMonth(value: string): { y: number; m: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!y || m < 1 || m > 12) return null;
  return { y, m };
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthAbr(value: string): string {
  const parsed = parseYearMonth(value.slice(0, 7));
  if (!parsed) return value;
  return `${MESES_ABR[parsed.m - 1]} ${parsed.y}`;
}

type MonthFieldProps = {
  value: string;
  onChange: (value: string) => void;
  max?: string;
  min?: string;
  className?: string;
  "aria-label"?: string;
};

/**
 * Casilla corta con texto "Nov 2026". Al tocar abre el selector nativo
 * de dos columnas (mes / año).
 */
export function MonthField({
  value,
  onChange,
  max,
  min,
  className,
  "aria-label": ariaLabel,
}: MonthFieldProps) {
  const parsed = parseYearMonth(value.slice(0, 7));
  const inputValue = parsed
    ? `${parsed.y}-${String(parsed.m).padStart(2, "0")}`
    : currentYearMonth();
  const label = parsed ? formatMonthAbr(inputValue) : "Mes";

  return (
    <div
      className={`relative isolate box-border flex items-center overflow-hidden ${className ?? ""}`}
    >
      <span
        aria-hidden
        className="pointer-events-none relative z-0 block w-full truncate leading-normal tabular-nums"
      >
        {label}
      </span>
      <input
        type="month"
        value={inputValue}
        max={max?.slice(0, 7) || undefined}
        min={min?.slice(0, 7) || undefined}
        aria-label={ariaLabel ?? "Mes"}
        onChange={(e) => {
          const next = e.target.value;
          if (next) onChange(next);
        }}
        onClick={(e) => {
          // Algunos navegadores solo abren el picker al tocar el ícono.
          const input = e.currentTarget;
          try {
            input.showPicker?.();
          } catch {
            /* ignore */
          }
        }}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </div>
  );
}
