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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const cargar = useCallback(async () => {
    setStatus("Cargando�");
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

  const monthKeys = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`),
    [anio],
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

      const categoria = categoriaDisplayLabel(r, catalogo).trim() || "Sin categor�a";
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
  }, [rowsSocios, anio, catalogo, monthKeys]);

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

  const thCls = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white";
  const thNum = `${thCls} text-right`;
  const tdCls = "px-3 py-2 text-sm text-slate-900";
  const tdNum = `${tdCls} text-right tabular-nums`;

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Socios</h1>
          <p className="mt-1 text-sm text-slate-600">
            Gastos asignados a las familias <strong>Mario</strong>, <strong>Mena</strong> y
            <strong> Victor</strong>, agrupados por categor�a y mes.
          </p>
        </div>
        <label className="text-sm text-slate-700">
          A�o
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
      </div>

      {status ? (
        <p className="rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
          {status}
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
        {bloques.map((bloque) => (
          <section
            key={bloque.socio}
            className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 shadow-md"
          >
            <h2 className="border-b border-[#3a9fe0] bg-[#5AC4FF] px-4 py-2 text-base font-semibold text-sky-950">
              {bloque.socio}
            </h2>
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF]">
                  <th className={thCls}>Categor�a</th>
                  {MONTH_LABELS.map((label, i) => (
                    <th key={monthKeys[i]} className={thNum}>
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
                      <tr key={rowKey} className="border-b border-slate-200/80 hover:bg-white/70">
                        <td className={tdCls}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 text-left text-sky-900 hover:underline"
                            onClick={() => toggleExpanded(rowKey)}
                            aria-expanded={open}
                          >
                            <span>{open ? "?" : "?"}</span>
                            <span className="font-medium">{r.categoria}</span>
                          </button>
                        </td>
                        {monthKeys.map((mk) => (
                          <td key={mk} className={tdNum}>
                            {formatClp(r.byMonth[mk] ?? 0)}
                          </td>
                        ))}
                        <td className={`${tdNum} font-semibold text-slate-900`}>{formatClp(r.total)}</td>
                      </tr>
                      {open ? (
                        <tr key={`${rowKey}-detail`} className="bg-white/80">
                          <td colSpan={14} className="px-4 py-3">
                            <ul className="space-y-2">
                              {r.items.map((it) => (
                                <li
                                  key={it.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs text-slate-500">{it.fecha}</p>
                                    <p className="truncate text-sm font-medium text-slate-900">
                                      {it.nombreDestino || "�"}
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
                    <td colSpan={14} className="px-4 py-6 text-center text-slate-500">
                      Sin movimientos para {bloque.socio} en {anio}.
                    </td>
                  </tr>
                ) : (
                  <tr className="bg-white/80">
                    <td className={`${tdCls} font-medium text-slate-900`}>Total</td>
                    {monthKeys.map((mk) => (
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
          </section>
        ))}
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

