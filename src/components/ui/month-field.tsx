"use client";

/** Abreviaturas cortas para que el filtro no corte nombres largos. */
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

function formatYearMonth(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
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
 * Reemplazo de input type="month": muestra "Sept 2026" en lugar de
 * "septiembre de 2026", que se corta en filtros angostos.
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
  const parsed = parseYearMonth(normalized);
  const maxParsed = parseYearMonth((max || "").slice(0, 7));
  const minParsed = parseYearMonth((min || "").slice(0, 7));

  const end = maxParsed ?? (() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1 };
  })();
  const start = minParsed ?? { y: end.y - 6, m: 1 };

  const options: string[] = [];
  let y = end.y;
  let m = end.m;
  const startKey = formatYearMonth(start.y, start.m);
  while (y > start.y || (y === start.y && m >= start.m)) {
    options.push(formatYearMonth(y, m));
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    if (options.length > 120) break;
  }

  if (parsed) {
    const key = formatYearMonth(parsed.y, parsed.m);
    if (!options.includes(key)) {
      const cmp = key.localeCompare(startKey);
      if (cmp < 0) options.push(key);
      else options.unshift(key);
    }
  }

  return (
    <select
      value={parsed ? formatYearMonth(parsed.y, parsed.m) : ""}
      aria-label={ariaLabel ?? "Mes"}
      onChange={(e) => {
        const next = e.target.value;
        if (next) onChange(next);
      }}
      className={className}
    >
      {!parsed ? <option value="">Mes</option> : null}
      {options.map((ym) => (
        <option key={ym} value={ym}>
          {formatMonthAbr(ym)}
        </option>
      ))}
    </select>
  );
}
