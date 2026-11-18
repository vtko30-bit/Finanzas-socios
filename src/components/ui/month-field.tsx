"use client";

/** Abreviaturas para etiquetas (tablas, listados). */
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
 * Usa el selector nativo del navegador (dos columnas: mes y año).
 * El campo va un poco más ancho para que no se corte el nombre del mes.
 */
export function MonthField({
  value,
  onChange,
  max,
  min,
  className,
  "aria-label": ariaLabel,
}: MonthFieldProps) {
  return (
    <input
      type="month"
      value={value.slice(0, 7)}
      max={max?.slice(0, 7)}
      min={min?.slice(0, 7)}
      aria-label={ariaLabel ?? "Mes"}
      onChange={(e) => {
        const next = e.target.value;
        if (next) onChange(next);
      }}
      className={className}
    />
  );
}
