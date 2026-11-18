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
  const normalized = value.slice(0, 7);
  const label = parseYearMonth(normalized)
    ? formatMonthAbr(normalized)
    : "Mes";

  return (
    <div className={`relative isolate overflow-hidden ${className ?? ""}`}>
      <span
        aria-hidden
        className="pointer-events-none relative z-0 flex h-full min-h-[2.25rem] w-full items-center truncate tabular-nums"
      >
        {label}
      </span>
      <input
        type="month"
        value={normalized}
        max={max?.slice(0, 7)}
        min={min?.slice(0, 7)}
        aria-label={ariaLabel ?? "Mes"}
        onChange={(e) => {
          const next = e.target.value;
          if (next) onChange(next);
        }}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
