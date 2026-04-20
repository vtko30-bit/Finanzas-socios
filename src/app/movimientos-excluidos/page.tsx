"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";

type Tab = "gastos" | "ventas";

type GastoExclRow = {
  id: string;
  fecha: string;
  origen: string;
  monto: number;
  descripcion: string;
  categoriaMostrada?: string;
  nombreDestino?: string;
  familia?: string | null;
};

type VentaExclRow = {
  id: string;
  fecha: string;
  sucursal: string;
  medioPago: string;
  monto: number;
  categoriaMostrada?: string;
  familia?: string | null;
  idVenta?: string;
};

type ExclItem = { familyId: string; familyName: string };

type FamiliaOpt = { id: string; name: string };
type CatalogFamily = {
  id: string;
  name: string;
  concepts: Array<{ id: string; label: string }>;
};
type SelectedLine =
  | {
      kind: "gasto";
      id: string;
      fecha: string;
      familia: string;
      categoria: string;
      detalle: string;
      monto: number;
    }
  | {
      kind: "venta";
      id: string;
      fecha: string;
      familia: string;
      categoria: string;
      detalle: string;
      monto: number;
    };

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

export default function MovimientosExcluidosPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const [tab, setTab] = useState<Tab>("gastos");
  const [gastos, setGastos] = useState<GastoExclRow[]>([]);
  const [ventas, setVentas] = useState<VentaExclRow[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [exclItems, setExclItems] = useState<ExclItem[]>([]);
  const [exclModalOpen, setExclModalOpen] = useState(false);
  const [familiasLoading, setFamiliasLoading] = useState(false);
  const [familiasLista, setFamiliasLista] = useState<FamiliaOpt[]>([]);
  const [pickerFilter, setPickerFilter] = useState("");
  const [mgmtMsg, setMgmtMsg] = useState("");
  const [savingFamilyId, setSavingFamilyId] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<SelectedLine | null>(null);
  const [editLineModalOpen, setEditLineModalOpen] = useState(false);
  const [catalogoFamilias, setCatalogoFamilias] = useState<CatalogFamily[]>([]);
  const [editLineFilter, setEditLineFilter] = useState("");
  const [savingConceptId, setSavingConceptId] = useState<string | null>(null);

  const cargar = useCallback(async (t: Tab) => {
    setLoading(true);
    setStatus("");
    try {
      if (t === "gastos") {
        const res = await fetch("/api/gastos/detalle?soloExcluidos=1");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al cargar egresos");
        const raw = (data.rows ?? []) as GastoExclRow[];
        setGastos(raw);
        setSelectedLine((prev) =>
          prev && prev.kind === "gasto" && raw.some((r) => r.id === prev.id) ? prev : null,
        );
      } else {
        const res = await fetch("/api/ventas/detalle?soloExcluidos=1");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al cargar ingresos");
        const raw = (data.rows ?? []) as VentaExclRow[];
        setVentas(raw);
        setSelectedLine((prev) =>
          prev && prev.kind === "venta" && raw.some((r) => r.id === prev.id) ? prev : null,
        );
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  const cargarExclusiones = useCallback(async () => {
    if (!authenticated) return;
    try {
      const res = await fetch("/api/organization/excluded-families");
      const json = (await res.json()) as { items?: ExclItem[]; error?: string };
      if (!res.ok) {
        setExclItems([]);
        return;
      }
      setExclItems(Array.isArray(json.items) ? json.items : []);
    } catch {
      setExclItems([]);
    }
  }, [authenticated]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void cargar(tab);
  }, [ready, authenticated, tab, cargar]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void cargarExclusiones();
  }, [ready, authenticated, cargarExclusiones]);

  const excludedFamilyIdSet = useMemo(
    () => new Set(exclItems.map((i) => i.familyId)),
    [exclItems],
  );

  const abrirModalExcluir = async () => {
    setExclModalOpen(true);
    setPickerFilter("");
    setMgmtMsg("");
    setFamiliasLoading(true);
    setFamiliasLista([]);
    try {
      const [famRes, exRes] = await Promise.all([
        fetch("/api/familias"),
        fetch("/api/organization/excluded-families"),
      ]);
      const famJson = (await famRes.json()) as {
        families?: { id: string; name: string }[];
        error?: string;
      };
      const exJson = (await exRes.json()) as { items?: ExclItem[] };

      if (!famRes.ok) {
        setMgmtMsg(famJson.error || "No se pudieron cargar las familias");
        return;
      }

      const list = (famJson.families ?? []).map((f) => ({
        id: f.id,
        name: f.name.trim() || f.id,
      }));
      list.sort((a, b) => a.name.localeCompare(b.name, "es"));
      setFamiliasLista(list);

      if (exRes.ok && Array.isArray(exJson.items)) {
        setExclItems(exJson.items);
      }
    } catch {
      setMgmtMsg("Error de red al cargar familias");
    } finally {
      setFamiliasLoading(false);
    }
  };

  const cerrarModal = useCallback(() => {
    setExclModalOpen(false);
    setPickerFilter("");
    setMgmtMsg("");
  }, []);

  useEffect(() => {
    if (!exclModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exclModalOpen, cerrarModal]);

  const familiasFiltradas = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase();
    if (!q) return familiasLista;
    return familiasLista.filter((f) => f.name.toLowerCase().includes(q));
  }, [familiasLista, pickerFilter]);

  const conceptosFiltrados = useMemo(() => {
    const q = editLineFilter.trim().toLowerCase();
    const conceptos = catalogoFamilias.flatMap((f) =>
      (f.concepts ?? []).map((c) => ({
        conceptId: c.id,
        label: c.label,
        familyName: f.name,
      })),
    );
    conceptos.sort((a, b) =>
      a.familyName === b.familyName
        ? a.label.localeCompare(b.label, "es")
        : a.familyName.localeCompare(b.familyName, "es"),
    );
    if (!q) return conceptos;
    return conceptos.filter(
      (c) => c.label.toLowerCase().includes(q) || c.familyName.toLowerCase().includes(q),
    );
  }, [catalogoFamilias, editLineFilter]);

  const elegirFamiliaExcluir = async (familyId: string) => {
    if (excludedFamilyIdSet.has(familyId)) {
      setMgmtMsg("Esa familia ya está excluida.");
      return;
    }
    setSavingFamilyId(familyId);
    setMgmtMsg("");
    try {
      const res = await fetch("/api/organization/excluded-families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId }),
      });
      const json = (await res.json()) as { error?: string; duplicate?: boolean };
      if (!res.ok) {
        setMgmtMsg(json.error || "No se pudo excluir la familia");
        return;
      }
      await cargarExclusiones();
      void cargar(tab);
      cerrarModal();
    } catch {
      setMgmtMsg("Error de red");
    } finally {
      setSavingFamilyId(null);
    }
  };

  const quitarExclusion = async (familyId: string) => {
    setMgmtMsg("");
    try {
      const res = await fetch(
        `/api/organization/excluded-families?familyId=${encodeURIComponent(familyId)}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMgmtMsg(json.error || "No se pudo quitar");
        return;
      }
      await cargarExclusiones();
      void cargar(tab);
    } catch {
      setMgmtMsg("Error de red");
    }
  };

  const seleccionarGasto = (r: GastoExclRow) => {
    setSelectedLine({
      kind: "gasto",
      id: r.id,
      fecha: r.fecha,
      familia: (r.familia ?? "").trim() || "—",
      categoria: r.categoriaMostrada?.trim() || "—",
      detalle: r.nombreDestino || r.descripcion || "—",
      monto: r.monto,
    });
    setStatus("");
  };

  const seleccionarVenta = (r: VentaExclRow) => {
    setSelectedLine({
      kind: "venta",
      id: r.id,
      fecha: r.fecha,
      familia: (r.familia ?? "").trim() || "—",
      categoria: r.categoriaMostrada?.trim() || "—",
      detalle: r.sucursal || "—",
      monto: r.monto,
    });
    setStatus("");
  };

  const abrirModalEditarLinea = async () => {
    if (!selectedLine || !canWrite) return;
    setEditLineModalOpen(true);
    setEditLineFilter("");
    setStatus("");
    try {
      const res = await fetch("/api/familias");
      const data = (await res.json()) as { families?: CatalogFamily[]; error?: string };
      if (!res.ok) {
        setStatus(data.error || "No se pudo cargar el catálogo");
        setEditLineModalOpen(false);
        return;
      }
      setCatalogoFamilias(data.families ?? []);
    } catch {
      setStatus("Error de red al cargar categorías");
      setEditLineModalOpen(false);
    }
  };

  const cerrarModalEditarLinea = useCallback(() => {
    setEditLineModalOpen(false);
    setEditLineFilter("");
    setSavingConceptId(null);
  }, []);

  useEffect(() => {
    if (!editLineModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarModalEditarLinea();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editLineModalOpen, cerrarModalEditarLinea]);

  const aplicarConceptoALinea = async (conceptId: string) => {
    if (!selectedLine) return;
    const endpoint =
      selectedLine.kind === "gasto"
        ? `/api/gastos/${selectedLine.id}`
        : `/api/ventas/${selectedLine.id}`;
    setSavingConceptId(conceptId);
    setStatus("");
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concept_id: conceptId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus(data.error || "No se pudo actualizar la categoría");
        return;
      }
      setStatus("Categoría actualizada.");
      cerrarModalEditarLinea();
      await cargar(tab);
    } catch {
      setStatus("Error de red al actualizar la línea");
    } finally {
      setSavingConceptId(null);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 pb-10 pt-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Movimientos excluidos del resumen
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/gastos"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-50"
          >
            Detalle de gastos
          </Link>
          <Link
            href="/ventas"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-50"
          >
            Detalle de ventas
          </Link>
          <Link
            href="/resumen"
            className="rounded-md border border-sky-600 bg-sky-50 px-3 py-1.5 text-sky-900 hover:bg-sky-100"
          >
            Resumen
          </Link>
        </div>
      </header>

      {!ready ? (
        <p className="text-sm text-slate-600">Verificando sesión…</p>
      ) : !authenticated ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Inicia sesión para ver esta vista.
        </p>
      ) : (
        <>
          <section
            aria-label="Familias excluidas del resumen"
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Familias excluidas del resumen
              </h2>
              {!capsLoading && canWrite ? (
                <button
                  type="button"
                  className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
                  onClick={() => void abrirModalExcluir()}
                >
                  Excluir familia
                </button>
              ) : !capsLoading ? (
                <p className="text-xs text-slate-500">
                  Solo el administrador puede excluir o restaurar familias.
                </p>
              ) : null}
            </div>
            {exclItems.length === 0 ? (
              <p className="mt-2 text-xs text-slate-600">
                Ninguna familia excluida. Usa «Excluir familia» para elegir una de la lista en{" "}
                <Link href="/familias" className="text-sky-700 underline">
                  Familias
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {exclItems.map((it) => (
                  <li
                    key={it.familyId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-800"
                  >
                    <span>{it.familyName}</span>
                    {!capsLoading && canWrite ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-rose-700 hover:underline"
                        onClick={() => void quitarExclusion(it.familyId)}
                      >
                        Quitar exclusión
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {mgmtMsg && !exclModalOpen ? (
              <p className="mt-2 text-xs text-amber-800">{mgmtMsg}</p>
            ) : null}
          </section>

          <div
            role="tablist"
            aria-label="Tipo de movimiento"
            className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "gastos"}
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                tab === "gastos"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setTab("gastos")}
            >
              Egresos
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "ventas"}
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                tab === "ventas"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setTab("ventas")}
            >
              Ingresos
            </button>
          </div>

          {status ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {status}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={loading}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void cargar(tab)}
            >
              {loading ? "Cargando…" : "Actualizar"}
            </button>
            <span className="text-sm text-slate-600">
              {tab === "gastos"
                ? `${gastos.length} movimiento(s)`
                : `${ventas.length} movimiento(s)`}
            </span>
          </div>

          {selectedLine ? (
            <section className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-amber-950">
                  Línea seleccionada: {selectedLine.fecha} · {selectedLine.familia} ·{" "}
                  {selectedLine.categoria} · {formatClp(selectedLine.monto)}
                </div>
                {!capsLoading && canWrite ? (
                  <button
                    type="button"
                    className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
                    onClick={() => void abrirModalEditarLinea()}
                  >
                    Editar categoría de esta línea
                  </button>
                ) : (
                  <span className="text-xs text-amber-800">
                    Solo el administrador puede editar la línea seleccionada.
                  </span>
                )}
              </div>
            </section>
          ) : null}

          {tab === "gastos" ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF] text-left text-xs font-medium text-white">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Familia</th>
                    <th className="px-3 py-2">Categoría</th>
                    <th className="px-3 py-2">Origen</th>
                    <th className="px-3 py-2">Destino / descr.</th>
                    <th className="px-3 py-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {gastos.length === 0 && !loading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No hay egresos excluidos. Configura familias excluidas arriba (requiere
                        administrador y movimientos con concepto en catálogo).
                      </td>
                    </tr>
                  ) : (
                    gastos.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-slate-200 cursor-pointer ${
                          selectedLine?.kind === "gasto" && selectedLine.id === r.id
                            ? "bg-amber-100/70"
                            : "hover:bg-slate-50"
                        }`}
                        onClick={() => seleccionarGasto(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            seleccionarGasto(r);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`Seleccionar egreso del ${r.fecha}`}
                      >
                        <td className="px-3 py-2 text-slate-800">{r.fecha}</td>
                        <td className="px-3 py-2 text-slate-800">
                          {(r.familia ?? "").trim() || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {r.categoriaMostrada?.trim() || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{r.origen || "—"}</td>
                        <td className="max-w-xs truncate px-3 py-2 text-slate-600">
                          {r.nombreDestino || r.descripcion || "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                          {formatClp(r.monto)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#3a9fe0] bg-[#5AC4FF] text-left text-xs font-medium text-white">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Familia</th>
                    <th className="px-3 py-2">Categoría</th>
                    <th className="px-3 py-2">Sucursal</th>
                    <th className="px-3 py-2">Medio de pago</th>
                    <th className="px-3 py-2">Id</th>
                    <th className="px-3 py-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.length === 0 && !loading ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No hay ingresos excluidos.
                      </td>
                    </tr>
                  ) : (
                    ventas.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-slate-200 cursor-pointer ${
                          selectedLine?.kind === "venta" && selectedLine.id === r.id
                            ? "bg-amber-100/70"
                            : "hover:bg-slate-50"
                        }`}
                        onClick={() => seleccionarVenta(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            seleccionarVenta(r);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`Seleccionar ingreso del ${r.fecha}`}
                      >
                        <td className="px-3 py-2 text-slate-800">{r.fecha}</td>
                        <td className="px-3 py-2 text-slate-800">
                          {(r.familia ?? "").trim() || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {r.categoriaMostrada?.trim() || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{r.sucursal || "—"}</td>
                        <td className="px-3 py-2 text-slate-700">{r.medioPago || "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {r.idVenta || "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                          {formatClp(r.monto)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {exclModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="excluir-fam-titulo"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cerrarModal();
          }}
        >
          <div className="flex max-h-[min(85vh,32rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 id="excluir-fam-titulo" className="text-base font-semibold text-slate-900">
                Elegir familia a excluir
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Se excluyen todos los movimientos cuyo concepto pertenezca a esa familia (ingresos y
                egresos con catálogo vinculado).
              </p>
              <label className="mt-2 block text-xs text-slate-600">
                Buscar
                <input
                  type="search"
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                  placeholder="Filtrar por nombre…"
                  value={pickerFilter}
                  onChange={(e) => setPickerFilter(e.target.value)}
                  autoFocus
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {familiasLoading ? (
                <p className="px-2 py-6 text-center text-sm text-slate-500">Cargando lista…</p>
              ) : familiasFiltradas.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-slate-500">
                  {familiasLista.length === 0
                    ? "No hay familias definidas."
                    : "Ninguna coincide con la búsqueda."}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {familiasFiltradas.map((f) => {
                    const ya = excludedFamilyIdSet.has(f.id);
                    const busy = savingFamilyId === f.id;
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          disabled={ya || busy || !!savingFamilyId}
                          className="flex w-full flex-col items-start rounded-md px-2 py-2 text-left text-sm hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => void elegirFamiliaExcluir(f.id)}
                        >
                          <span className="font-medium text-slate-900">{f.name}</span>
                          <span className="text-xs text-slate-500">
                            {ya ? "Ya excluida" : "Pulsa para excluir del resumen"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {mgmtMsg ? (
              <p className="border-t border-slate-100 px-4 py-2 text-xs text-amber-800">{mgmtMsg}</p>
            ) : null}
            <div className="border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
                onClick={cerrarModal}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editLineModalOpen && selectedLine ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="editar-linea-titulo"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cerrarModalEditarLinea();
          }}
        >
          <div className="flex max-h-[min(85vh,32rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 id="editar-linea-titulo" className="text-base font-semibold text-slate-900">
                Editar categoría de línea excluida
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Selecciona una categoría. Si la nueva familia no está excluida, la línea dejará de
                aparecer aquí.
              </p>
              <label className="mt-2 block text-xs text-slate-600">
                Buscar categoría o familia
                <input
                  type="search"
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                  placeholder="Ej: Ventas locales, Operación, etc."
                  value={editLineFilter}
                  onChange={(e) => setEditLineFilter(e.target.value)}
                  autoFocus
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {conceptosFiltrados.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-slate-500">
                  No hay categorías disponibles o no coincide con la búsqueda.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {conceptosFiltrados.map((c) => {
                    const busy = savingConceptId === c.conceptId;
                    return (
                      <li key={c.conceptId}>
                        <button
                          type="button"
                          disabled={!!savingConceptId}
                          className="flex w-full flex-col items-start rounded-md px-2 py-2 text-left text-sm hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void aplicarConceptoALinea(c.conceptId)}
                        >
                          <span className="font-medium text-slate-900">{c.label}</span>
                          <span className="text-xs text-slate-500">
                            {c.familyName}
                            {busy ? " · Guardando…" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
                onClick={cerrarModalEditarLinea}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
