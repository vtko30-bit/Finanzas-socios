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

function clampYearMonth(
  y: number,
  m: number,
  min: { y: number; m: number } | null,
  max: { y: number; m: number } | null,
): { y: number; m: number } {
  let next = { y, m };
  if (min) {
    const key = formatYearMonth(next.y, next.m);
    if (key < formatYearMonth(min.y, min.m)) next = { ...min };
  }
  if (max) {
    const key = formatYearMonth(next.y, next.m);
    if (key > formatYearMonth(max.y, max.m)) next = { ...max };
  }
  return next;
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
 * Selector de mes en dos columnas (mes + año), con meses abreviados.
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

  const now = new Date();
  const end = maxParsed ?? { y: now.getFullYear(), m: now.getMonth() + 1 };
  const start = minParsed ?? { y: end.y - 6, m: 1 };

  const year = parsed?.y ?? end.y;
  const month = parsed?.m ?? end.m;

  const years: number[] = [];
  for (let y = end.y; y >= start.y; y -= 1) years.push(y);
  if (parsed && !years.includes(parsed.y)) {
    years.push(parsed.y);
    years.sort((a, b) => b - a);
  }

  const monthsForYear = MESES_ABR.map((label, idx) => {
    const m = idx + 1;
    const key = formatYearMonth(year, m);
    const belowMin = minParsed
      ? key < formatYearMonth(minParsed.y, minParsed.m)
      : false;
    const aboveMax = maxParsed
      ? key > formatYearMonth(maxParsed.y, maxParsed.m)
      : false;
    return { m, label, disabled: belowMin || aboveMax };
  });

  function emit(y: number, m: number) {
    const next = clampYearMonth(y, m, minParsed, maxParsed);
    onChange(formatYearMonth(next.y, next.m));
  }

  const fieldClass = className ?? "";

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      role="group"
      aria-label={ariaLabel ?? "Mes"}
    >
      <select
        value={parsed ? month : ""}
        aria-label="Mes"
        onChange={(e) => {
          const m = Number(e.target.value);
          if (!m) return;
          emit(year, m);
        }}
        className={fieldClass}
      >
        {!parsed ? <option value="">Mes</option> : null}
        {monthsForYear.map(({ m, label, disabled }) => (
          <option key={m} value={m} disabled={disabled}>
            {label}
          </option>
        ))}
      </select>
      <select
        value={parsed ? year : ""}
        aria-label="Año"
        onChange={(e) => {
          const y = Number(e.target.value);
          if (!y) return;
          emit(y, month);
        }}
        className={fieldClass}
      >
        {!parsed ? <option value="">Año</option> : null}
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
