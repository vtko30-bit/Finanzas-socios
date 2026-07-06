"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type CatalogConcept = { id: string; label: string };
type CatalogFamily = {
  id: string;
  name: string;
  sort_order: number;
  concepts: CatalogConcept[];
};

type GastoRow = {
  fecha: string;
  origen: string;
  id: string;
  nombreDestino: string;
  descripcion: string;
  monto: number;
  concepto: string;
  concept_id: string | null;
  familia: string | null;
};

type CategoriaPivot = {
  categoria: string;
  byMonth: Record<string, number>;
  total: number;
  items: GastoRow[];
};

const SOCIOS = ["Mario", "Mena", "Victor"] as const;
const MONTH_LABELS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
] as const;

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

function fechaIsoDia(fecha: string): string {
  const s = (fecha || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function etiquetaCatalogoParaId(
  conceptId: string,
  families: CatalogFamily[],
): string | null {
  for (const f of families) {
    for (const c of f.concepts) {
      if (c.id === conceptId) return c.label;
    }
  }
  return null;
}

function categoriaDisplayLabel(
  row: GastoRow,
  catalogo: CatalogFamily[],
): string {
  const t = (row.concepto || "").trim();
  if (t) return t;
  if (row.concept_id) {
    return etiquetaCatalogoParaId(row.concept_id, catalogo) ?? "";
  }
  return "";
}

export default function SociosPage() {
  const [rows, setRows] = useState<GastoRow[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogFamily[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [anio, setAnio] = useState(() => String(new Date().getFullYear()));
  const [mes, setMes] = useState<string>("todos");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedSocio, setExpandedSocio] = useState<Record<string, boolean>>({});

  const cargar = useCallback(async () => {
    setStatus("Cargando...");
    try {
      const [resG, resF] = await Promise.all([
        fetch("/api/gastos/detalle"),
        fetch("/api/familias"),
      ]);
      const dataG = await resG.json();
      const dataF = await resF.json();

      if (!resG.ok) {
        setRows([]);
        setStatus(dataG.error || "No se pudieron cargar los movimientos");
        return;
      }
      setRows((dataG.rows ?? []) as GastoRow[]);

      if (resF.ok) {
        setCatalogo((dataF.families ?? []) as CatalogFamily[]);
      } else {
        setCatalogo([]);
      }

      setStatus(null);
    } catch {
      setRows([]);
      setCatalogo([]);
      setStatus("Error de red");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  useEffect(() => {
    setExpanded({});
    setExpandedSocio({});
  }, [anio, mes]);

  const monthKeys = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`),
    [anio],
  );
  const visibleMonthKeys = useMemo(
    () => (mes === "todos" ? monthKeys : [`${anio}-${mes}`]),
    [anio, mes, monthKeys],
  );
  const visibleMonthLabels = useMemo(
    () =>
      mes === "todos"
        ? [...MONTH_LABELS]
        : [MONTH_LABELS[Math.max(0, Number(mes) - 1)] ?? mes],
    [mes],
  );

  const yearsDisponibles = useMemo(() => {
    const years = new Set<string>([String(new Date().getFullYear())]);
    for (const r of rows) {
      const iso = fechaIsoDia(r.fecha);
      if (iso) years.add(iso.slice(0, 4));
    }
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [rows]);

  const sociosSet = useMemo(
    () => new Set(SOCIOS.map((n) => n.toLowerCase())),
    [],
  );

  const rowsSocios = useMemo(() => {
    return rows.filter((r) => sociosSet.has((r.familia || "").trim().toLowerCase()));
  }, [rows, sociosSet]);

  const pivotBySocio = useMemo(() => {
    const bySocio: Record<string, Map<string, CategoriaPivot>> = {
      mario: new Map(),
      mena: new Map(),
      victor: new Map(),
    };

    for (const r of rowsSocios) {
      const fam = (r.familia || "").trim().toLowerCase();
      const socioMap = bySocio[fam];
      if (!socioMap) continue;

      const iso = fechaIsoDia(r.fecha);
      if (!iso || !iso.startsWith(`${anio}-`)) continue;
      const mk = iso.slice(0, 7);
      if (mes !== "todos" && mk !== `${anio}-${mes}`) continue;

      const categoria = categoriaDisplayLabel(r, catalogo).trim() || "Sin categoría";
      const key = categoria.toLowerCase();

      const cur =
        socioMap.get(key) ?? {
          categoria,
          byMonth: Object.fromEntries(monthKeys.map((k) => [k, 0])) as Record<string, number>,
          total: 0,
          items: [],
        };

      cur.byMonth[mk] = (cur.byMonth[mk] ?? 0) + r.monto;
      cur.total += r.monto;
      cur.items.push(r);
      socioMap.set(key, cur);
    }

    return bySocio;
  }, [rowsSocios, anio, mes, catalogo, monthKeys]);

  const bloques = useMemo(() => {
    return SOCIOS.map((socio) => {
      const m = pivotBySocio[socio.toLowerCase()] ?? new Map<string, CategoriaPivot>();
      const rowsCategoria = Array.from(m.values()).sort((a, b) => b.total - a.total);
      for (const r of rowsCategoria) {
        r.items.sort((a, b) => fechaIsoDia(b.fecha).localeCompare(fechaIsoDia(a.fecha)));
      }
      const total = rowsCategoria.reduce((sum, r) => sum + r.total, 0);
      return { socio, rowsCategoria, total };
    });
  }, [pivotBySocio]);

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSocioExpanded = (socio: string) => {
    setExpandedSocio((prev) => ({ ...prev, [socio]: !prev[socio] }));
  };

  const thCls = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white";
  const thNum = `${thCls} text-right`;
  const thCatSticky = `${thCls} sticky left-0 z-20 min-w-[6.75rem] max-w-[9rem] bg-[#0056ff] shadow-[4px_0_6px_-4px_rgba(15,23,42,0.25)]`;
  const tdCls = "px-3 py-2 text-xs text-slate-900";
  const tdNum = `${tdCls} text-right tabular-nums`;
  const tdCatSticky =
    `${tdCls} sticky left-0 z-10 min-w-[6.75rem] max-w-[9rem] bg-white shadow-[4px_0_6px_-4px_rgba(15,23,42,0.08)]`;
  const tdCatStickyMuted = `${tdCatSticky} bg-slate-50`;

  return (
    <main className="page-main page-main--2xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Socios</h1>
        </div>
        <div className="flex items-end gap-3">
          <label className="text-sm text-slate-700">
            Año
            <select
              className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
            >
              {yearsDisponibles.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Mes
            <select
              className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            >
              <option value="todos">Todos</option>
              {MONTH_LABELS.map((label, i) => {
                const value = String(i + 1).padStart(2, "0");
                return (
                  <option key={value} value={value}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      </div>

      {status ? (
        <p className="rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
          {status}
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
        {bloques.map((bloque) => {
          const socioOpen = Boolean(expandedSocio[bloque.socio]);
          return (
          <section
            key={bloque.socio}
            className="ui-card-panel min-w-0 overflow-x-auto"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left sm:hidden"
              onClick={() => toggleSocioExpanded(bloque.socio)}
              aria-expanded={socioOpen}
            >
              <span className="text-base font-semibold text-sky-950">{bloque.socio}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-sky-800">
                {formatClp(bloque.total)}
              </span>
              <span className="shrink-0 text-xs text-slate-500" aria-hidden>
                {socioOpen ? "▲" : "▼"}
              </span>
            </button>
            <h2 className="ui-table-header hidden px-4 py-2 text-base font-semibold text-sky-950 sm:block">
              {bloque.socio}
            </h2>
            <div className={socioOpen ? "block" : "hidden sm:block"}>
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="ui-table-header">
                  <th className={thCatSticky}>Categoría</th>
                  {visibleMonthLabels.map((label, i) => (
                    <th key={visibleMonthKeys[i]} className={thNum}>
                      {label}
                    </th>
                  ))}
                  <th className={thNum}>Total</th>
                </tr>
              </thead>
              <tbody>
                {bloque.rowsCategoria.map((r) => {
                  const rowKey = `${bloque.socio}::${r.categoria.toLowerCase()}`;
                  const open = Boolean(expanded[rowKey]);
                  return (
                    <Fragment key={rowKey}>
                      <tr key={rowKey} className="group border-b border-slate-200/80 hover:bg-white/70">
                        <td className={`${tdCatSticky} group-hover:bg-slate-50`}>
                          <button
                            type="button"
                            className="inline-flex w-full items-center justify-between gap-2 text-left text-sky-900 hover:underline sm:inline-flex sm:w-auto sm:justify-start"
                            onClick={() => toggleExpanded(rowKey)}
                            aria-expanded={open}
                          >
                            <span className="font-medium">{r.categoria}</span>
                            <span className="shrink-0 text-[10px] text-slate-500 sm:hidden" aria-hidden>
                              {open ? "▲" : "▼"}
                            </span>
                          </button>
                        </td>
                        {visibleMonthKeys.map((mk) => (
                          <td key={mk} className={tdNum}>
                            {formatClp(r.byMonth[mk] ?? 0)}
                          </td>
                        ))}
                        <td className={`${tdNum} font-semibold text-slate-900`}>{formatClp(r.total)}</td>
                      </tr>
                      {open ? (
                        <tr key={`${rowKey}-detail`} className="bg-white/80">
                          <td colSpan={visibleMonthKeys.length + 2} className="px-3 py-3 sm:px-4">
                            <ul className="space-y-2">
                              {r.items.map((it) => (
                                <li
                                  key={it.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs text-slate-500">{it.fecha}</p>
                                    <p className="truncate text-sm font-medium text-slate-900">
                                      {it.nombreDestino || "—"}
                                    </p>
                                    {it.descripcion ? (
                                      <p className="truncate text-xs text-slate-600">{it.descripcion}</p>
                                    ) : null}
                                  </div>
                                  <span className="text-sm font-medium tabular-nums text-slate-900">
                                    {formatClp(it.monto)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}

                {bloque.rowsCategoria.length === 0 ? (
                  <tr>
                    <td colSpan={visibleMonthKeys.length + 2} className="px-4 py-6 text-center text-slate-500">
                      Sin movimientos para {bloque.socio} en {anio}
                      {mes === "todos" ? "" : ` (${visibleMonthLabels[0]})`}.
                    </td>
                  </tr>
                ) : (
                  <tr className="bg-white/80">
                    <td className={`${tdCatStickyMuted} font-medium text-slate-900`}>Total</td>
                    {visibleMonthKeys.map((mk) => (
                      <td key={mk} className={`${tdNum} font-medium text-slate-900`}>
                        {formatClp(
                          bloque.rowsCategoria.reduce((sum, row) => sum + (row.byMonth[mk] ?? 0), 0),
                        )}
                      </td>
                    ))}
                    <td className={`${tdNum} font-semibold text-sky-800`}>{formatClp(bloque.total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </section>
          );
        })}
      </div>

      {rowsSocios.length === 0 && !status ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No hay movimientos para Mario, Mena o Victor. Puedes revisar y clasificar en{" "}
          <Link href="/gastos" className="font-medium underline hover:no-underline">
            Gastos
          </Link>
          .
        </p>
      ) : null}
    </main>
  );
}

