"use client";

import { useCallback, useEffect, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";

type FamilyRow = {
  id: string;
  name: string;
  sort_order: number;
};

type ConceptoInv = {
  id: string | null;
  label: string;
  family_id: string | null;
  solo_planilla: boolean;
};

type ModalEditCatalogo = {
  kind: "catalogo";
  id: string;
  label: string;
  familyId: string;
};

type ModalEditPlanilla = {
  kind: "planilla";
  labelOriginal: string;
  label: string;
};

type ModalEdit = ModalEditCatalogo | ModalEditPlanilla;

function IconPencil({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-slate-600 transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default function FamiliasPage() {
  const { canWrite } = useOrgCapabilities();
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [conceptos, setConceptos] = useState<ConceptoInv[]>([]);
  const [status, setStatus] = useState("Cargando…");
  const [toast, setToast] = useState("");
  const [nuevaFamilia, setNuevaFamilia] = useState("");
  const [editandoFamilia, setEditandoFamilia] = useState<string | null>(null);
  const [nombreFamiliaEdit, setNombreFamiliaEdit] = useState("");
  const [expandedFamilyIds, setExpandedFamilyIds] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** Clave de concepto → familia objetivo (null = quitar del catálogo). Solo diferencias respecto al servidor hasta Guardar. */
  const [pendingFamilyByConcept, setPendingFamilyByConcept] = useState<
    Record<string, string | null>
  >({});

  const [modalEdit, setModalEdit] = useState<ModalEdit | null>(null);
  const [modalNuevaFamilia, setModalNuevaFamilia] = useState(false);

  const mostrar = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 5000);
  }, []);

  const cargar = useCallback(() => {
    setStatus("Cargando…");
    fetch("/api/conceptos-inventario")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al cargar");
        setFamilies(data.families ?? []);
        setConceptos(data.conceptos ?? []);
        setStatus("");
      })
      .catch((e: Error) => {
        setStatus(e.message);
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const toggleExpand = (familyId: string) => {
    setExpandedFamilyIds((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  };

  const contarEnFamilia = (familyId: string) =>
    conceptos.filter((c) => getTargetFamilyId(c) === familyId).length;

  const confirmarNuevaFamilia = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nuevaFamilia.trim();
    if (!name) {
      mostrar("Indica el nombre de la familia");
      return;
    }
    const res = await fetch("/api/familias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo crear la familia");
      return;
    }
    setNuevaFamilia("");
    setModalNuevaFamilia(false);
    mostrar("Familia creada");
    cargar();
  };

  const eliminarFamilia = async (id: string) => {
    if (!window.confirm("¿Eliminar esta familia y todas sus categorías del catálogo?")) return;
    const res = await fetch(`/api/familias/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo eliminar");
      return;
    }
    mostrar("Familia eliminada");
    cargar();
  };

  const guardarNombreFamilia = async (id: string) => {
    const name = nombreFamiliaEdit.trim();
    if (!name) return;
    const res = await fetch(`/api/familias/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo guardar");
      return;
    }
    setEditandoFamilia(null);
    mostrar("Familia actualizada");
    cargar();
  };

  const conceptoRowKey = (c: ConceptoInv) => (c.id ? c.id : `planilla:${c.label}`);

  /** Familia efectiva (servidor + cambios pendientes). */
  const getTargetFamilyId = (c: ConceptoInv): string | null => {
    const k = conceptoRowKey(c);
    if (Object.prototype.hasOwnProperty.call(pendingFamilyByConcept, k)) {
      return pendingFamilyByConcept[k];
    }
    return c.family_id;
  };

  /**
   * Categorías visibles bajo una familia: destino pendiente coincide, o sin asignar (planilla / pendiente de quitar).
   */
  const conceptosParaFamilia = (familyId: string) =>
    conceptos.filter((c) => {
      const target = getTargetFamilyId(c);
      if (target === null) return true;
      return target === familyId;
    });

  const actualizarPendienteCheckbox = (
    c: ConceptoInv,
    familyId: string,
    marcar: boolean,
  ) => {
    const k = conceptoRowKey(c);
    setPendingFamilyByConcept((p) => {
      const prevT = Object.prototype.hasOwnProperty.call(p, k) ? p[k] : c.family_id;
      let nextTarget: string | null;
      if (marcar) {
        nextTarget = familyId;
      } else {
        if (prevT !== familyId) return p;
        nextTarget = null;
      }
      const server = c.family_id;
      const next = { ...p };
      if (nextTarget === server) {
        delete next[k];
      } else {
        next[k] = nextTarget;
      }
      return next;
    });
  };

  const guardarPendientes = async () => {
    const entries = Object.entries(pendingFamilyByConcept);
    if (entries.length === 0) return;

    setBusyKey("__batch__");
    try {
      const toDelete: ConceptoInv[] = [];
      const toCreate: { c: ConceptoInv; familyId: string }[] = [];
      const toPatch: { c: ConceptoInv; familyId: string }[] = [];

      for (const [k, target] of entries) {
        const c = conceptos.find((x) => conceptoRowKey(x) === k);
        if (!c) continue;
        const server = c.family_id;
        if (target === server) continue;
        if (target === null) {
          if (c.id && server) toDelete.push(c);
        } else if (!c.id) {
          toCreate.push({ c, familyId: target });
        } else if (c.family_id !== target) {
          toPatch.push({ c, familyId: target });
        }
      }

      if (toDelete.length > 0) {
        if (
          !window.confirm(
            `¿Quitar ${toDelete.length} categoría(s) del catálogo? Los gastos enlazados quedarán solo con texto (sin catálogo).`,
          )
        ) {
          return;
        }
        for (const c of toDelete) {
          const res = await fetch(`/api/conceptos-catalogo/${c.id}`, {
            method: "DELETE",
          });
          const data = await res.json();
          if (!res.ok) {
            mostrar(data.error || "No se pudo quitar una categoría");
            return;
          }
        }
      }

      let creadosVinc = 0;
      for (const { c, familyId } of toCreate) {
        const res = await fetch("/api/conceptos-catalogo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            family_id: familyId,
            label: c.label,
            vincular_gastos_sin_catalogo: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          mostrar(data.error || "No se pudo crear en el catálogo");
          return;
        }
        creadosVinc += Number(data.gastos_vinculados ?? 0);
      }

      for (const { c, familyId } of toPatch) {
        const res = await fetch(`/api/conceptos-catalogo/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ family_id: familyId }),
        });
        const data = await res.json();
        if (!res.ok) {
          mostrar(data.error || "No se pudo mover de familia");
          return;
        }
      }

      setPendingFamilyByConcept({});
      if (creadosVinc > 0) {
        mostrar(`Cambios guardados. ${creadosVinc} gasto(s) enlazado(s) al catálogo.`);
      } else {
        mostrar("Cambios guardados");
      }
      cargar();
    } finally {
      setBusyKey(null);
    }
  };

  const guardarModalEdit = async () => {
    if (!modalEdit) return;
    if (modalEdit.kind === "catalogo") {
      const label = modalEdit.label.trim();
      if (!label) {
        mostrar("El nombre no puede estar vacío");
        return;
      }
      const res = await fetch(`/api/conceptos-catalogo/${modalEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          family_id: modalEdit.familyId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        mostrar(data.error || "No se pudo guardar");
        return;
      }
      setModalEdit(null);
      setPendingFamilyByConcept({});
      mostrar("Categoría actualizada");
      cargar();
      return;
    }

    const nuevo = modalEdit.label.trim();
    if (!nuevo) {
      mostrar("El nombre no puede estar vacío");
      return;
    }
    const res = await fetch("/api/conceptos-planilla", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label_actual: modalEdit.labelOriginal,
        label_nuevo: nuevo,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      mostrar(data.error || "No se pudo renombrar");
      return;
    }
    setModalEdit(null);
    setPendingFamilyByConcept({});
    mostrar(`Renombrado en ${data.actualizados ?? 0} gasto(s)`);
    cargar();
  };

  const abrirEditarCategoria = (c: ConceptoInv, familiaContextoId?: string) => {
    if (c.id) {
      setModalEdit({
        kind: "catalogo",
        id: c.id,
        label: c.label,
        familyId: c.family_id ?? familiaContextoId ?? families[0]?.id ?? "",
      });
    } else {
      setModalEdit({
        kind: "planilla",
        labelOriginal: c.label,
        label: c.label,
      });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      {toast ? (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      <div>
        <h1 className="text-xl font-semibold text-slate-900">Familias</h1>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-md">
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-[#3a9fe0] bg-[#5AC4FF] px-6 py-2">
          <button
            type="button"
            disabled={!canWrite}
            className="shrink-0 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            onClick={() => {
              setNuevaFamilia("");
              setModalNuevaFamilia(true);
            }}
          >
            Agregar familia
          </button>
        </div>
        <div className="border-t border-slate-200 px-6 py-4 space-y-4">
        {Object.keys(pendingFamilyByConcept).length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-50/90 px-3 py-2.5 text-sm">
            <p className="text-amber-900">
              Tienes{" "}
              <strong>{Object.keys(pendingFamilyByConcept).length}</strong> cambio(s) de
              categoría sin guardar. Marca o desmarca varias familias y pulsa Guardar para
              aplicarlos.
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-200 disabled:opacity-50"
                disabled={busyKey === "__batch__" || !canWrite}
                onClick={() => setPendingFamilyByConcept({})}
              >
                Descartar
              </button>
              <button
                type="button"
                className="rounded border border-sky-600 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                disabled={busyKey === "__batch__" || !canWrite}
                onClick={() => void guardarPendientes()}
              >
                {busyKey === "__batch__" ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        ) : null}
        {status ? (
          <p className="text-sm text-slate-600">{status}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {families.map((fam) => {
              const open = expandedFamilyIds.has(fam.id);
              const count = contarEnFamilia(fam.id);
              return (
                <li
                  key={fam.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100/90"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => toggleExpand(fam.id)}
                      aria-expanded={open}
                    >
                      <IconChevron open={open} />
                      {editandoFamilia === fam.id ? (
                        <span className="text-sm text-slate-600">(editando nombre…)</span>
                      ) : (
                        <>
                          <span className="font-medium text-slate-900">{fam.name}</span>
                          <span className="text-xs text-slate-500">
                            {count} categoría(s) aquí
                          </span>
                        </>
                      )}
                    </button>
                    <div className="flex shrink-0 gap-2">
                      {editandoFamilia === fam.id ? (
                        <>
                          <input
                            className="w-40 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                            value={nombreFamiliaEdit}
                            onChange={(e) => setNombreFamiliaEdit(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void guardarNombreFamilia(fam.id);
                              if (e.key === "Escape") setEditandoFamilia(null);
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="text-xs text-sky-400 hover:underline"
                            onClick={() => void guardarNombreFamilia(fam.id)}
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            className="text-xs text-slate-500"
                            onClick={() => setEditandoFamilia(null)}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={!canWrite}
                            className="text-xs text-slate-600 hover:text-sky-400 disabled:opacity-40"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditandoFamilia(fam.id);
                              setNombreFamiliaEdit(fam.name);
                            }}
                          >
                            Renombrar
                          </button>
                          <button
                            type="button"
                            disabled={!canWrite}
                            className="text-xs text-rose-400/90 hover:underline disabled:opacity-40"
                            onClick={(e) => {
                              e.stopPropagation();
                              void eliminarFamilia(fam.id);
                            }}
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {open ? (
                    <div className="border-t border-slate-200 px-3 py-2">
                      <ul className="max-h-[min(60vh,28rem)] space-y-1 overflow-y-auto pr-1">
                        {conceptosParaFamilia(fam.id).length === 0 ? (
                          <li className="px-2 py-3 text-sm text-slate-500">
                            No hay categorías sin asignar ni pertenecientes a esta familia. Las que
                            ya están en otra familia solo se ven al abrir esa familia.
                          </li>
                        ) : (
                          conceptosParaFamilia(fam.id).map((c) => {
                            const rowKey = conceptoRowKey(c);
                            const checked = getTargetFamilyId(c) === fam.id;
                            const batchBusy = busyKey === "__batch__";
                            return (
                              <li
                                key={`${fam.id}-${rowKey}`}
                                className="flex flex-wrap items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-100"
                              >
                                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 shrink-0 rounded border-slate-300"
                                    checked={checked}
                                    disabled={batchBusy || !canWrite}
                                    onChange={(e) => {
                                      actualizarPendienteCheckbox(
                                        c,
                                        fam.id,
                                        e.target.checked,
                                      );
                                    }}
                                  />
                                  <span className="min-w-0 truncate text-sm text-slate-800">
                                    {c.label}
                                  </span>
                                  {c.solo_planilla ? (
                                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-500/90">
                                      planilla
                                    </span>
                                  ) : null}
                                </label>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={!canWrite}
                                    className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-sky-400 disabled:opacity-40"
                                    title="Editar nombre"
                                    aria-label="Editar nombre"
                                    onClick={() => abrirEditarCategoria(c, fam.id)}
                                  >
                                    <IconPencil />
                                  </button>
                                  {c.id && getTargetFamilyId(c) === fam.id ? (
                                    <button
                                      type="button"
                                      className="px-1.5 text-xs text-rose-400/90 hover:underline"
                                      disabled={batchBusy || !canWrite}
                                      onClick={() =>
                                        actualizarPendienteCheckbox(c, fam.id, false)
                                      }
                                    >
                                      Quitar
                                    </button>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {!families.length && !status ? (
              <li className="text-sm text-slate-500">Crea al menos una familia para comenzar.</li>
            ) : null}
          </ul>
        )}
        </div>
      </section>

      {modalNuevaFamilia ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-nueva-familia-titulo"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setNuevaFamilia("");
              setModalNuevaFamilia(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl">
            <h3
              id="modal-nueva-familia-titulo"
              className="text-lg font-semibold text-slate-900"
            >
              Nueva familia
            </h3>
            <form onSubmit={(e) => void confirmarNuevaFamilia(e)} className="mt-4">
              <label className="block text-xs text-slate-600">
                Nombre
                <input
                  type="text"
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                  placeholder="Ej: Remuneración, Operación, Impuestos…"
                  value={nuevaFamilia}
                  onChange={(e) => setNuevaFamilia(e.target.value)}
                  autoFocus
                  aria-label="Nombre de la nueva familia"
                />
              </label>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-200"
                  onClick={() => {
                    setNuevaFamilia("");
                    setModalNuevaFamilia(false);
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded border border-sky-600 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                >
                  Crear familia
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modalEdit ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-edit-titulo"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalEdit(null);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl">
            <h3 id="modal-edit-titulo" className="text-lg font-semibold text-slate-900">
              {modalEdit.kind === "planilla"
                ? "Editar categoría (planilla)"
                : "Editar categoría"}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {modalEdit.kind === "planilla"
                ? "Se actualizará el texto en todos los gastos importados que tengan esta categoría y aún no estén en el catálogo."
                : "Cambios en el catálogo; los gastos enlazados se actualizan según corresponda."}
            </p>
            <label className="mt-4 block text-xs text-slate-600">
              Nombre
              <input
                type="text"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                value={modalEdit.label}
                onChange={(e) =>
                  setModalEdit((m) => {
                    if (!m) return m;
                    if (m.kind === "planilla") return { ...m, label: e.target.value };
                    return { ...m, label: e.target.value };
                  })
                }
              />
            </label>
            {modalEdit.kind === "catalogo" ? (
              <label className="mt-3 block text-xs text-slate-600">
                Familia
                <select
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={modalEdit.familyId}
                  onChange={(e) =>
                    setModalEdit((m) =>
                      m && m.kind === "catalogo"
                        ? { ...m, familyId: e.target.value }
                        : m,
                    )
                  }
                >
                  {families.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-200"
                onClick={() => setModalEdit(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded border border-sky-600 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                onClick={() => void guardarModalEdit()}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

