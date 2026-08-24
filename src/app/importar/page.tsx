"use client";

import { FormEvent, useCallback, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";
import { invalidateMainNavCaches } from "@/lib/client-fetch-cache";

type ImportResult = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  inserted: number;
  duplicates: number;
  detectedGroupedByDay?: boolean;
  groupedDailyRows?: number;
  skippedVentasDuplicateRows?: number;
  ventasCoalesce?: {
    skippedResumenMirrorRows: number;
    skippedDuplicateDayAmountRows: number;
    skippedSummarySheets: string[];
  };
  invalidSample?: Array<{ row_number: number; reason: string }>;
  sheetsUsed?: string[];
  detectedHeaders?: string[];
  availableSheets?: string[];
  heldForDuplicateReview?: number;
  skippedByHashDuplicate?: number;
  skippedDuplicateRowInFile?: number;
};

type DuplicateReviewItem = {
  dedupe_hash: string;
  row_number: number;
  date: string;
  amount: number;
  counterparty: string;
  description: string;
  source_id: string;
  external_ref: string;
  origen_hint: string;
  matches_existing: Array<{
    id: string;
    date: string;
    amount: number;
    source_id: string;
    created_at: string;
  }>;
};

function ymdLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days);
  return ymdLocal(dt);
}

export default function ImportarPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const [file, setFile] = useState<File | null>(null);
  const [fileVentas, setFileVentas] = useState<File | null>(null);
  const [filePagoServicios, setFilePagoServicios] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileOtrosIngresos, setFileOtrosIngresos] = useState<File | null>(null);
  const [loadingConsolidado, setLoadingConsolidado] = useState(false);
  const [loadingPagoServicios, setLoadingPagoServicios] = useState(false);
  const [loadingOtrosIngresos, setLoadingOtrosIngresos] = useState(false);
  const [loadingVentas, setLoadingVentas] = useState(false);
  const [loadingFudoVentas, setLoadingFudoVentas] = useState(false);
  const [loadingFudoGastos, setLoadingFudoGastos] = useState(false);
  const [fudoDesde, setFudoDesde] = useState(() => addDaysYmd(ymdLocal(), -1));
  const [fudoHasta, setFudoHasta] = useState(() => ymdLocal());
  const [loadingResetTodo, setLoadingResetTodo] = useState(false);
  const [loadingResetVentas, setLoadingResetVentas] = useState(false);
  const [loadingBackup, setLoadingBackup] = useState(false);
  const [backupTarget, setBackupTarget] = useState<null | "ingresos" | "todo">(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [duplicateReview, setDuplicateReview] = useState<{
    batchId: string;
    items: DuplicateReviewItem[];
  } | null>(null);
  const [duplicateDecisions, setDuplicateDecisions] = useState<
    Record<string, "insert" | "skip">
  >({});
  const [confirmingDupes, setConfirmingDupes] = useState(false);

  const parseApiBody = (text: string): { error?: string; [k: string]: unknown } => {
    if (!text) return {};
    try {
      return JSON.parse(text) as { error?: string; [k: string]: unknown };
    } catch {
      return { error: text };
    }
  };

  /** Une error/details/hint/code por si la API solo rellena parte de los campos (p. ej. PostgREST). */
  const mensajeApi = (data: Record<string, unknown>) => {
    const parts = [data.error, data.details, data.hint]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    const base = parts.join(" — ");
    const code =
      typeof data.code === "string" && data.code.trim()
        ? ` (código ${data.code.trim()})`
        : "";
    return (base + code).trim();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !file) return;
    setLoadingConsolidado(true);
    setStatus("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/import/consolidado", {
        method: "POST",
        body: fd,
      });
      const text = await res.text();
      const data = parseApiBody(text);

      if (!res.ok) {
        if (res.status === 423 && data.periodLocked) {
          setStatus(
            typeof data.error === "string"
              ? data.error
              : "Hay fechas en un período cerrado para importación. Revisa Períodos cerrados o quita esas filas del archivo.",
          );
        } else if (res.status === 409 && data.duplicateFile) {
          setStatus(
            "Archivo duplicado: ese mismo Excel ya se importó antes. Si actualizaste datos, guarda una nueva versión del archivo e inténtalo otra vez.",
          );
        } else if (res.status === 400) {
          setStatus(
            mensajeApi(data) ||
              'Archivo inválido. Anticipos_Consumo_Personal debe tener hoja "Detalle" con Fecha y Monto; otros archivos: hoja Egresos y Cheques / Cargos.',
          );
        } else {
          setStatus(mensajeApi(data) || "Error al importar");
        }
        return;
      }

      const importData = data as ImportResult;
      setResult(importData);
      if (importData.validRows === 0 && importData.invalidRows > 0) {
        setStatus(
          "No se importó ninguna fila válida. Anticipos_Consumo_Personal: hoja Detalle con Fecha y Monto; otros: hoja Egresos con Fecha y Cheques / Cargos.",
        );
        return;
      }
      if (importData.inserted === 0 && importData.validRows > 0) {
        setStatus(
          "No se agregaron movimientos nuevos: todas las filas válidas ya existen (duplicadas) o repetidas dentro del mismo archivo.",
        );
        return;
      }
      setStatus("Importación de gastos y egresos finalizada.");
      setSuccessMessage("La importación de gastos y egresos terminó correctamente.");
      invalidateMainNavCaches();
      setShowSuccessModal(true);
    } catch (error) {
      setStatus(
        `Error inesperado al importar: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingConsolidado(false);
    }
  };

  const submitPagoServicios = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !filePagoServicios) return;
    setLoadingPagoServicios(true);
    setStatus("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", filePagoServicios);
      const res = await fetch("/api/import/egresos-bancoestado-servicios", {
        method: "POST",
        body: fd,
      });
      const text = await res.text();
      const data = parseApiBody(text);

      if (!res.ok) {
        if (res.status === 423 && data.periodLocked) {
          setStatus(
            typeof data.error === "string"
              ? data.error
              : "Hay fechas en un período cerrado para importación. Revisa Períodos cerrados o quita esas filas del archivo.",
          );
        } else if (res.status === 409 && data.duplicateFile) {
          setStatus(
            "Archivo duplicado: ese mismo Excel de Pago servicios BancoEstado ya está asociado a un lote (importado o pendiente de confirmar). Elimínalo en Importaciones o guarda una versión distinta del archivo.",
          );
        } else if (res.status === 400) {
          setStatus(
            mensajeApi(data) ||
              'Archivo inválido. Anticipos_Consumo_Personal debe tener hoja "Detalle" con Fecha y Monto; otros archivos: hoja Egresos y Cheques / Cargos.',
          );
        } else {
          setStatus(mensajeApi(data) || "Error al importar Pago servicios BancoEstado");
        }
        return;
      }

      const importData = data as ImportResult & {
        requiresDuplicateConfirmation?: boolean;
        duplicateReview?: { pending: boolean; items: DuplicateReviewItem[] };
        batchId?: string;
        heldForDuplicateReview?: number;
        skippedByHashDuplicate?: number;
        skippedDuplicateRowInFile?: number;
      };

      setResult({
        totalRows: importData.totalRows,
        validRows: importData.validRows,
        invalidRows: importData.invalidRows,
        inserted: importData.inserted,
        duplicates: importData.duplicates,
        invalidSample: importData.invalidSample,
        heldForDuplicateReview: importData.heldForDuplicateReview,
        skippedByHashDuplicate: importData.skippedByHashDuplicate,
        skippedDuplicateRowInFile: importData.skippedDuplicateRowInFile,
      });

      if (importData.requiresDuplicateConfirmation && importData.duplicateReview?.items?.length) {
        const batchId = String(importData.batchId ?? "");
        if (!batchId) {
          setStatus("Respuesta incompleta: falta batchId para confirmar duplicados.");
          return;
        }
        setDuplicateReview({
          batchId,
          items: importData.duplicateReview.items,
        });
        setDuplicateDecisions({});
        const held = importData.heldForDuplicateReview ?? importData.duplicateReview.items.length;
        const ins = importData.inserted ?? 0;
        setStatus(
          ins > 0
            ? `Se importaron ${ins} fila(s). Hay ${held} fila(s) muy parecidas a movimientos ya cargados: indica en cada una si es duplicado (omitir) o un pago nuevo (importar).`
            : `Hay ${held} fila(s) muy parecidas a movimientos ya cargados. Indica en cada una si es duplicado (omitir) o un pago nuevo (importar).`,
        );
        return;
      }

      setStatus("Importación de Pago servicios BancoEstado finalizada.");
      setSuccessMessage("La importación de Pago servicios BancoEstado terminó correctamente.");
      invalidateMainNavCaches();
      setShowSuccessModal(true);
    } catch (error) {
      setStatus(
        `Error inesperado al importar Pago servicios BancoEstado: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingPagoServicios(false);
    }
  };

  const submitVentas = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !fileVentas) return;
    setLoadingVentas(true);
    setStatus("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", fileVentas);
      const res = await fetch("/api/import/ventas", {
        method: "POST",
        body: fd,
      });
      const text = await res.text();
      const data = parseApiBody(text);

      if (!res.ok) {
        if (res.status === 423 && data.periodLocked) {
          setStatus(
            typeof data.error === "string"
              ? data.error
              : "Hay fechas en un período cerrado para importación. Revisa Períodos cerrados o quita esas filas del archivo.",
          );
        } else if (res.status === 409 && data.duplicateFile) {
          setStatus(
            "Archivo duplicado: ese Excel de ventas ya se importó. Si cambiaste datos, guarda una copia nueva.",
          );
        } else {
          setStatus(mensajeApi(data) || "Error al importar ventas");
        }
        return;
      }

      const importData = data as ImportResult;
      setResult(importData);
      if (importData.validRows === 0 && importData.invalidRows > 0) {
        setStatus(
          "No se importó ninguna fila válida. Revisa los motivos de ejemplo abajo y el formato del Excel.",
        );
      } else if (importData.inserted === 0 && importData.validRows > 0) {
        setStatus(
          "Todas las filas válidas ya estaban importadas (duplicadas). Puedes borrar ingresos en Ventas y volver a subir, o usar un archivo distinto.",
        );
      } else {
        const formatoMsg = importData.detectedGroupedByDay
          ? ` Se detectó formato resumido por día (${importData.groupedDailyRows ?? 0} fila(s) agrupadas).`
          : "";
        const dedupeMsg =
          (importData.skippedVentasDuplicateRows ?? 0) > 0
            ? ` Se omitieron ${importData.skippedVentasDuplicateRows} fila(s) duplicadas del Excel (resumen repetido o misma hoja en varias pestañas).`
            : "";
        setStatus(`Importación de ventas finalizada. Revisa la vista Ventas.${formatoMsg}${dedupeMsg}`);
      }
      setSuccessMessage("La importación de ventas terminó correctamente.");
      invalidateMainNavCaches();
      setShowSuccessModal(true);
    } catch (error) {
      setStatus(
        `Error inesperado al importar ventas: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingVentas(false);
    }
  };

  const submitFudoVentas = async () => {
    if (!authenticated) return;
    setLoadingFudoVentas(true);
    setStatus("");
    setResult(null);
    try {
      const res = await fetch("/api/fudo/sync-ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fudoDesde, to: fudoHasta }),
      });
      const text = await res.text();
      const data = parseApiBody(text);
      if (!res.ok) {
        setStatus(mensajeApi(data) || "Error al sincronizar ventas de Fudo");
        return;
      }
      const inserted = Number(data.inserted ?? 0);
      const duplicates = Number(data.duplicates ?? 0);
      const fetched = Number(data.fetched ?? 0);
      const skippedLocked = Number(data.skippedLocked ?? 0);
      const skippedResumen = Number(data.skippedResumenDays ?? 0);
      const errs = Array.isArray(data.errors)
        ? (data.errors as unknown[]).map(String).filter(Boolean)
        : [];
      const extra = [
        skippedLocked > 0 ? `${skippedLocked} en período cerrado` : "",
        skippedResumen > 0
          ? `${skippedResumen} omitidas (ese día ya tiene ventas resumidas)`
          : "",
        errs.length ? errs.join(" · ") : "",
      ]
        .filter(Boolean)
        .join(". ");
      setStatus(
        `Fudo: ${inserted} venta(s) nueva(s) de ${fetched} leídas (${duplicates} ya estaban).${
          extra ? ` ${extra}` : ""
        }`,
      );
      invalidateMainNavCaches();
      if (inserted > 0) {
        setSuccessMessage("Las ventas de Fudo se actualizaron.");
        setShowSuccessModal(true);
      }
    } catch (error) {
      setStatus(
        `Error inesperado al sincronizar Fudo: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingFudoVentas(false);
    }
  };

  const submitFudoGastos = async () => {
    if (!authenticated) return;
    setLoadingFudoGastos(true);
    setStatus("");
    setResult(null);
    try {
      const res = await fetch("/api/fudo/sync-gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fudoDesde, to: fudoHasta }),
      });
      const text = await res.text();
      const data = parseApiBody(text);
      if (!res.ok) {
        setStatus(mensajeApi(data) || "Error al sincronizar gastos de Fudo");
        return;
      }
      const inserted = Number(data.inserted ?? 0);
      const duplicates = Number(data.duplicates ?? 0);
      const fetched = Number(data.fetched ?? 0);
      const skippedLocked = Number(data.skippedLocked ?? 0);
      const skippedId = Number(data.skippedExistingId ?? 0);
      const errs = Array.isArray(data.errors)
        ? (data.errors as unknown[]).map(String).filter(Boolean)
        : [];
      const extra = [
        skippedLocked > 0 ? `${skippedLocked} en período cerrado` : "",
        skippedId > 0 ? `${skippedId} ya importados (mismo Id)` : "",
        errs.length ? errs.join(" · ") : "",
      ]
        .filter(Boolean)
        .join(". ");
      setStatus(
        `Fudo: ${inserted} gasto(s) nuevo(s) de ${fetched} leídos (${duplicates} ya estaban).${
          extra ? ` ${extra}` : ""
        }`,
      );
      invalidateMainNavCaches();
      if (inserted > 0) {
        setSuccessMessage("Los gastos de Fudo se actualizaron.");
        setShowSuccessModal(true);
      }
    } catch (error) {
      setStatus(
        `Error inesperado al sincronizar gastos de Fudo: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingFudoGastos(false);
    }
  };

  const submitOtrosIngresos = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticated || !fileOtrosIngresos) return;
    setLoadingOtrosIngresos(true);
    setStatus("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", fileOtrosIngresos);
      const res = await fetch("/api/import/otros-ingresos", { method: "POST", body: fd });
      const text = await res.text();
      const data = parseApiBody(text);

      if (!res.ok) {
        if (res.status === 423 && data.periodLocked) {
          setStatus(
            typeof data.error === "string"
              ? data.error
              : "Hay fechas en un período cerrado para importación. Revisa Períodos cerrados o quita esas filas del archivo.",
          );
        } else if (res.status === 409 && data.duplicateFile) {
          setStatus(
            "Archivo duplicado: este Excel de otros ingresos ya se importó. Si actualizaste datos, exporta un archivo nuevo.",
          );
        } else if (res.status === 400) {
          setStatus(
            mensajeApi(data) ||
              'Archivo inválido. Verifica que exista la hoja "Ingresos" y columnas como Fecha y Depósitos / Abonos.',
          );
        } else {
          setStatus(mensajeApi(data) || "Error al importar otros ingresos");
        }
        return;
      }

      const importData = data as ImportResult;
      setResult(importData);
      if (importData.validRows === 0 && importData.invalidRows > 0) {
        setStatus(
          "No se importó ninguna fila válida en la hoja Ingresos. Revisa los ejemplos abajo y el formato.",
        );
      } else if (importData.inserted === 0 && importData.validRows > 0) {
        setStatus(
          "Todas las filas válidas ya estaban importadas (duplicadas). Puedes borrar movimientos o usar un archivo distinto.",
        );
      } else {
        setStatus("Importación de otros ingresos finalizada.");
      }
      setSuccessMessage("La importación de otros ingresos terminó correctamente.");
      invalidateMainNavCaches();
      setShowSuccessModal(true);
    } catch (error) {
      setStatus(
        `Error inesperado al importar otros ingresos: ${
          error instanceof Error ? error.message : "desconocido"
        }`,
      );
    } finally {
      setLoadingOtrosIngresos(false);
    }
  };

  const descargarRespaldo = useCallback(
    async (kind: "ingresos" | "todo"): Promise<boolean> => {
      setLoadingBackup(true);
      setBackupTarget(kind);
      setStatus("");
      try {
        const res = await fetch(`/api/import/respaldo-pre-borrado?kind=${kind}`);
        if (!res.ok) {
          const text = await res.text();
          const data = parseApiBody(text);
          setStatus(mensajeApi(data) || "No se pudo generar el respaldo");
          return false;
        }
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition");
        let filename = `respaldo-${kind}.json`;
        const m = cd?.match(/filename="([^"]+)"/i);
        if (m?.[1]) filename = m[1];
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus(
          `Respaldo descargado (${filename}). Confirma el siguiente paso para borrar los datos.`,
        );
        return true;
      } catch {
        setStatus("Error de red al generar el respaldo");
        return false;
      } finally {
        setLoadingBackup(false);
        setBackupTarget(null);
      }
    },
    [],
  );

  const borrarTodosLosIngresosVentas = async () => {
    if (!authenticated) return;
    const ok1 = window.confirm(
      "Paso 1 de 2: se generará y descargará un archivo JSON con respaldo de todos los ingresos y de los lotes de importación de ventas.\n\n" +
        "¿Continuar con la descarga del respaldo?",
    );
    if (!ok1) return;

    const backupOk = await descargarRespaldo("ingresos");
    if (!backupOk) return;

    const ok2 = window.confirm(
      "Paso 2 de 2: ¿Confirmar eliminación definitiva?\n\n" +
        "Se borrarán todos los movimientos de ingreso y los lotes de ventas. Los egresos no se borran. " +
        "Asegúrate de haber guardado el archivo de respaldo descargado.",
    );
    if (!ok2) return;

    setLoadingResetVentas(true);
    setStatus("");
    setResult(null);
    try {
      const res = await fetch("/api/ventas/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "No se pudo borrar los ingresos");
        return;
      }
      setStatus(
        "Movimientos de ingreso y lotes de importación de ventas eliminados. Puedes importar de nuevo.",
      );
      invalidateMainNavCaches();
    } catch {
      setStatus("Error de red al borrar ingresos");
    } finally {
      setLoadingResetVentas(false);
    }
  };

  const borrarTodoMovimientos = async () => {
    if (!authenticated) return;
    const ok1 = window.confirm(
      "Paso 1 de 2: se generará y descargará un archivo JSON con respaldo de todos los movimientos y de todos los lotes de importación.\n\n" +
        "¿Continuar con la descarga del respaldo?",
    );
    if (!ok1) return;

    const backupOk = await descargarRespaldo("todo");
    if (!backupOk) return;

    const ok2 = window.confirm(
      "Paso 2 de 2: ¿Confirmar eliminación definitiva?\n\n" +
        "Se borrarán todos los gastos, todos los ingresos y el historial de importaciones. " +
        "No se borran familias ni conceptos del catálogo. Asegúrate de haber guardado el respaldo descargado.",
    );
    if (!ok2) return;

    setLoadingResetTodo(true);
    setStatus("");
    setResult(null);
    try {
      const res = await fetch("/api/import/reset-todo", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "No se pudo borrar los datos");
        return;
      }
      setStatus(
        `Listo: se eliminaron ${data.deletedTransactions ?? 0} movimientos y ${data.deletedImportBatches ?? 0} lotes de importación.`,
      );
      invalidateMainNavCaches();
    } catch {
      setStatus("Error de red al borrar datos");
    } finally {
      setLoadingResetTodo(false);
    }
  };

  const borradoBusy =
    loadingBackup || loadingResetVentas || loadingResetTodo;

  const aceptarImportacionExitosa = () => {
    setShowSuccessModal(false);
    setSuccessMessage("");
    setFile(null);
    setFileVentas(null);
    setFilePagoServicios(null);
    setFileOtrosIngresos(null);
    setResult(null);
    setStatus("");
    setDuplicateReview(null);
    setDuplicateDecisions({});
    setFileInputVersion((v) => v + 1);
  };

  const formatClp = (n: number) =>
    new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      maximumFractionDigits: 0,
    }).format(n || 0);

  const submitDuplicateDecisions = async () => {
    if (!duplicateReview) return;
    for (const it of duplicateReview.items) {
      const d = duplicateDecisions[it.dedupe_hash];
      if (d !== "insert" && d !== "skip") {
        setStatus("Indica en cada fila si es duplicado (omitir) o un pago nuevo (importar).");
        return;
      }
    }
    setConfirmingDupes(true);
    setStatus("");
    try {
      const res = await fetch("/api/import/egresos-bancoestado-servicios/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: duplicateReview.batchId,
          decisions: duplicateDecisions,
        }),
      });
      const text = await res.text();
      const data = parseApiBody(text);
      if (!res.ok) {
        if (res.status === 423 && data.periodLocked) {
          setStatus(
            typeof data.error === "string"
              ? data.error
              : "Hay fechas en un período cerrado. Reabre el período en Períodos cerrados o elige omitir esas filas.",
          );
        } else {
          setStatus(mensajeApi(data) || "No se pudo confirmar la revisión de duplicados");
        }
        return;
      }
      setDuplicateReview(null);
      setDuplicateDecisions({});
      setStatus(
        `Revisión aplicada: se importaron ${Number(data.inserted ?? 0)} fila(s) adicionales; se omitieron ${Number(data.skipped ?? 0)}.`,
      );
      setSuccessMessage("La importación de Pago servicios BancoEstado quedó completa.");
      invalidateMainNavCaches();
      setShowSuccessModal(true);
    } catch (error) {
      setStatus(
        `Error de red al confirmar: ${error instanceof Error ? error.message : "desconocido"}`,
      );
    } finally {
      setConfirmingDupes(false);
    }
  };

  if (authenticated && capsLoading) {
    return (
      <main className="page-main page-main--md">
        <p className="text-sm text-slate-600">Verificando permisos…</p>
      </main>
    );
  }

  if (authenticated && !canWrite) {
    return (
      <main className="page-main page-main--md">
        <p className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Tu cuenta tiene acceso de solo lectura. Solo el administrador de la organización (rol owner)
          puede importar archivos o usar las herramientas de borrado.
        </p>
      </main>
    );
  }

  return (
    <main className="page-main page-main--md">
      <section
        aria-label="Períodos cerrados"
        className="rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-3 text-sm text-slate-800"
      >
        <h2 className="font-semibold text-indigo-950">Períodos cerrados para importación</h2>
        <p className="mt-2 text-slate-700">
          Puedes cerrar un <strong className="font-medium text-slate-900">mes o año</strong> para que ninguna
          importación Excel inserte movimientos nuevos con fecha en ese rango. Reabre el período cuando necesites
          volver a cargar correcciones.{" "}
          <a href="/periodos-cerrados" className="font-medium text-indigo-800 underline">
            Gestionar períodos cerrados
          </a>
          .
        </p>
      </section>

      <section
        aria-label="Ayuda sobre duplicados"
        className="rounded-xl border border-sky-200 bg-sky-50/90 px-4 py-3 text-sm text-slate-800"
      >
        <h2 className="font-semibold text-sky-950">Archivos repetidos y datos nuevos</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
          <li>
            La app reconoce si el Excel es <strong className="font-medium text-slate-900">idéntico</strong> al que ya
            importaste (por el contenido del archivo, no solo por el nombre). En ese caso no se importa de nuevo.
          </li>
          <li>
            Si <strong className="font-medium text-slate-900">agregaste filas o cambiaste datos</strong> y guardaste el
            archivo, el contenido cambia: se puede importar otra vez. Las filas con el mismo Id de origen se omiten; si
            una fila es <strong className="font-medium text-slate-900">idéntica en datos</strong> a un movimiento ya
            cargado pero con Id distinto, la app te pedirá confirmar si es duplicado o un pago nuevo (p. ej. transferencias
            por lote con el mismo monto y proveedor).
          </li>
          <li>
            Puedes volver a subir un archivo con el <strong className="font-medium text-slate-900">mismo nombre</strong>{" "}
            siempre que no sea byte por byte igual al ya importado.
          </li>
        </ul>
      </section>

      <section className="ui-card p-6">
        <h1 className="page-title">Actualizar desde Fudo</h1>
        <p className="mt-2 text-sm text-slate-600">
          Trae ventas y gastos de Rg y Happy. Lo que ya está (Excel o Fudo) no
          se duplica. El cron diario también actualiza ambos.
        </p>
        <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="text-sm text-slate-700">
            Desde
            <input
              type="date"
              className="ui-field mt-1"
              value={fudoDesde}
              onChange={(e) => setFudoDesde(e.target.value)}
              disabled={!authenticated || loadingFudoVentas || loadingFudoGastos}
            />
          </label>
          <label className="text-sm text-slate-700">
            Hasta
            <input
              type="date"
              className="ui-field mt-1"
              value={fudoHasta}
              onChange={(e) => setFudoHasta(e.target.value)}
              disabled={!authenticated || loadingFudoVentas || loadingFudoGastos}
            />
          </label>
          <button
            type="button"
            onClick={() => void submitFudoVentas()}
            disabled={
              !authenticated ||
              !canWrite ||
              capsLoading ||
              loadingFudoVentas ||
              loadingFudoGastos ||
              !fudoDesde ||
              !fudoHasta
            }
            className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loadingFudoVentas ? "Sincronizando…" : "Actualizar ventas"}
          </button>
          <button
            type="button"
            onClick={() => void submitFudoGastos()}
            disabled={
              !authenticated ||
              !canWrite ||
              capsLoading ||
              loadingFudoVentas ||
              loadingFudoGastos ||
              !fudoDesde ||
              !fudoHasta
            }
            className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loadingFudoGastos ? "Sincronizando…" : "Actualizar gastos"}
          </button>
        </form>
      </section>

      <section className="ui-card p-6">
        <h1 className="page-title">Importar Excel de ventas</h1>
        <p className="mt-2 text-xs text-amber-800">
          Si este archivo corresponde a egresos, impórtalo en{" "}
          <strong className="text-slate-800">Importar gastos y egresos</strong> (sección siguiente),
          no aquí.
        </p>
        {!ready ? (
          <p className="mt-3 text-xs text-slate-600">Verificando sesión...</p>
        ) : null}
        {ready && !authenticated ? (
          <p className="mt-3 ui-alert-warning">
            Debes iniciar sesión para importar. Usa el botón Reingresar en la cabecera.
          </p>
        ) : null}
        <form onSubmit={submitVentas} className="mt-5 flex flex-col gap-3">
          <input
            key={`file-ventas-${fileInputVersion}`}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFileVentas(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2"
            required
            disabled={!authenticated || loadingVentas}
          />
          <button
            disabled={!authenticated || !fileVentas || loadingVentas}
            className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loadingVentas ? "Procesando..." : "Importar ventas (ingresos)"}
          </button>
        </form>
      </section>

      <section className="ui-card p-6">
        <h2 className="text-lg font-semibold">Importar gastos y egresos</h2>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
          <input
            key={`file-consolidado-${fileInputVersion}`}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2"
            required
            disabled={!authenticated || loadingConsolidado}
          />
          <button
            disabled={!authenticated || !file || loadingConsolidado}
            className="ui-btn-primary"
          >
            {loadingConsolidado ? "Procesando..." : "Importar gastos y egresos"}
          </button>
        </form>
      </section>

      <section className="ui-card p-6">
        <h2 className="text-lg font-semibold">Importar Pago servicios BancoEstado</h2>
        <p className="mt-2 text-xs text-slate-600">
          Este archivo se carga en una vista separada para no mezclarse con el detalle normal de
          gastos.
        </p>
        <form onSubmit={submitPagoServicios} className="mt-5 flex flex-col gap-3">
          <input
            key={`file-pago-servicios-${fileInputVersion}`}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFilePagoServicios(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2"
            required
            disabled={!authenticated || loadingPagoServicios}
          />
          <button
            disabled={!authenticated || !filePagoServicios || loadingPagoServicios}
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loadingPagoServicios
              ? "Procesando..."
              : "Importar Pago servicios BancoEstado"}
          </button>
        </form>
      </section>

      <section className="ui-card p-6">
        <h2 className="text-lg font-semibold">Importar otros ingresos</h2>
        <form onSubmit={submitOtrosIngresos} className="mt-5 flex flex-col gap-3">
          <input
            key={`file-otros-${fileInputVersion}`}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFileOtrosIngresos(e.target.files?.[0] ?? null)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2"
            required
            disabled={!authenticated || loadingOtrosIngresos}
          />
          <button
            disabled={!authenticated || !fileOtrosIngresos || loadingOtrosIngresos}
            className="rounded-md bg-violet-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {loadingOtrosIngresos ? "Procesando..." : "Importar otros ingresos"}
          </button>
        </form>
      </section>

      {status ? (
        <p className="ui-card px-4 py-3 text-sm text-slate-700">
          {status}
        </p>
      ) : null}

      <section className="rounded-xl border border-rose-900/50 bg-slate-50 p-6">
        <h2 className="font-semibold text-rose-900">Borrar datos de prueba</h2>
        <p className="mt-2 text-sm text-slate-600">
          <strong className="text-slate-800">Solo ingresos:</strong> borra{" "}
          <strong className="text-slate-800">todos</strong> los movimientos de ingreso (incluye ventas y otros
          ingresos importados) y los lotes de importación de ventas; no borra egresos.{" "}
          <strong className="text-slate-800">Todo:</strong> elimina gastos e ingresos y todos los lotes
          importados. Antes de cada borrado se descarga un <strong className="text-slate-800">JSON de respaldo</strong>{" "}
          y hace falta confirmar en dos pasos.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!authenticated || borradoBusy}
            className="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            onClick={() => void borrarTodosLosIngresosVentas()}
          >
            {loadingResetVentas
              ? "Borrando…"
              : loadingBackup && backupTarget === "ingresos"
                ? "Generando respaldo…"
                : "Borrar todos los ingresos"}
          </button>
          <button
            type="button"
            disabled={!authenticated || borradoBusy}
            className="rounded-md border border-rose-400 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
            onClick={() => void borrarTodoMovimientos()}
          >
            {loadingResetTodo
              ? "Borrando…"
              : loadingBackup && backupTarget === "todo"
                ? "Generando respaldo…"
                : "Borrar todos los movimientos e importaciones"}
          </button>
        </div>
      </section>

      {result ? (
        <section className="ui-card p-6">
          <h2 className="font-semibold">Resultado del lote</h2>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            <li>Filas totales: {result.totalRows}</li>
            <li>Filas válidas: {result.validRows}</li>
            <li>Filas inválidas: {result.invalidRows}</li>
            <li>Nuevas insertadas: {result.inserted}</li>
            <li>Duplicadas omitidas (mismo Id en base): {result.duplicates}</li>
            {result.detectedGroupedByDay ? (
              <li>
                Formato detectado: ventas agrupadas por día ({result.groupedDailyRows ?? 0} fila(s)).
              </li>
            ) : null}
            {(result.skippedVentasDuplicateRows ?? 0) > 0 ? (
              <li>
                Filas duplicadas omitidas del Excel (resumen repetido o varias pestañas):{" "}
                {result.skippedVentasDuplicateRows}
              </li>
            ) : null}
            {result.heldForDuplicateReview != null && result.heldForDuplicateReview > 0 ? (
              <li>Pendientes de tu confirmación (posible duplicado): {result.heldForDuplicateReview}</li>
            ) : null}
            {result.skippedDuplicateRowInFile != null && result.skippedDuplicateRowInFile > 0 ? (
              <li>Filas repetidas dentro del mismo archivo: {result.skippedDuplicateRowInFile}</li>
            ) : null}
            {result.availableSheets?.length ? (
              <li>Hojas en el archivo: {result.availableSheets.join(", ")}</li>
            ) : null}
            {result.sheetsUsed?.length ? (
              <li>Hojas leídas: {result.sheetsUsed.join(", ")}</li>
            ) : null}
            {result.detectedHeaders?.length ? (
              <li>Columnas detectadas: {result.detectedHeaders.join(", ")}</li>
            ) : null}
          </ul>
          {result.invalidRows > 0 && result.invalidSample?.length ? (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <p className="text-xs font-medium text-amber-900">
                Ejemplos de filas rechazadas (primeras {result.invalidSample.length}):
              </p>
              <ul className="mt-2 max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-xs text-amber-50/95">
                {result.invalidSample.map((s) => (
                  <li key={`${s.row_number}-${s.reason.slice(0, 40)}`}>
                    Fila {s.row_number}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {duplicateReview ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dup-review-title"
        >
          <div className="my-4 w-full max-w-2xl rounded-xl border border-amber-400 bg-amber-50 p-6 shadow-xl">
            <h3 id="dup-review-title" className="text-lg font-semibold text-amber-950">
              Confirmar posibles duplicados (Pago servicios BancoEstado)
            </h3>
            <p className="mt-2 text-sm text-amber-900/95">
              Cada fila del archivo coincide en fecha, monto, destino, descripción, origen y cuenta con un movimiento ya
              importado, pero trae un <strong className="text-amber-950">Id de origen distinto</strong>. Indica si es el
              mismo pago (omitir) o un pago distinto (importar).
            </p>
            <ul className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto">
              {duplicateReview.items.map((it) => (
                <li
                  key={it.dedupe_hash}
                  className="rounded-lg border border-amber-300/80 bg-white/90 p-3 text-sm text-slate-800"
                >
                  <div className="font-medium text-slate-900">
                    Fila Excel {it.row_number} · {it.date} · {formatClp(it.amount)}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    Destino: {it.counterparty || "—"} · Origen: {it.origen_hint || "—"}
                  </div>
                  <div className="mt-1 text-xs text-slate-600">Id archivo: {it.source_id || "—"}</div>
                  <div className="mt-1 text-xs text-slate-700">Descripción: {it.description || "—"}</div>
                  <div className="mt-2 text-xs font-medium text-slate-700">Coincide con movimiento(es) en la app:</div>
                  <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                    {it.matches_existing.map((m) => (
                      <li key={m.id}>
                        Id app {m.id.slice(0, 8)}… · fecha {m.date} · Id origen {m.source_id || "—"} · importado{" "}
                        {m.created_at ? new Date(m.created_at).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—"}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded border px-3 py-1.5 text-xs font-medium ${
                        duplicateDecisions[it.dedupe_hash] === "skip"
                          ? "border-amber-800 bg-amber-200 text-amber-950"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() =>
                        setDuplicateDecisions((d) => ({ ...d, [it.dedupe_hash]: "skip" }))
                      }
                    >
                      Es duplicado (omitir)
                    </button>
                    <button
                      type="button"
                      className={`rounded border px-3 py-1.5 text-xs font-medium ${
                        duplicateDecisions[it.dedupe_hash] === "insert"
                          ? "border-emerald-800 bg-emerald-200 text-emerald-950"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() =>
                        setDuplicateDecisions((d) => ({ ...d, [it.dedupe_hash]: "insert" }))
                      }
                    >
                      Es pago nuevo (importar)
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-amber-200/80 pt-4">
              <button
                type="button"
                className="rounded border border-slate-400 bg-white px-4 py-2 text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                disabled={confirmingDupes}
                onClick={() => {
                  setDuplicateReview(null);
                  setDuplicateDecisions({});
                  setStatus(
                    "Revisión cancelada en pantalla. El lote sigue en Importaciones: puedes eliminarlo ahí si no quieres confirmar.",
                  );
                }}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="rounded border border-amber-800 bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                disabled={confirmingDupes}
                onClick={() => void submitDuplicateDecisions()}
              >
                {confirmingDupes ? "Aplicando…" : "Aplicar decisiones"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSuccessModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-success-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-slate-50 p-6 shadow-xl">
            <h3 id="import-success-title" className="text-lg font-semibold text-slate-900">
              Importación finalizada
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {successMessage || "El archivo se importó correctamente."}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="rounded border border-sky-600 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                onClick={aceptarImportacionExitosa}
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
