"use client";

import { FormEvent, useCallback, useState } from "react";
import { useOrgCapabilities } from "@/components/org-capabilities-provider";
import { useAuthState } from "@/hooks/use-auth-state";
import { invalidateMainNavCaches } from "@/lib/client-fetch-cache";

export default function ImportarPage() {
  const { ready, authenticated } = useAuthState();
  const { canWrite, loading: capsLoading } = useOrgCapabilities();
  const [status, setStatus] = useState("");
  const [bancoFrom, setBancoFrom] = useState("");
  const [bancoTo, setBancoTo] = useState("");
  const [loadingBanco, setLoadingBanco] = useState(false);
  const [bancoStatus, setBancoStatus] = useState("");
  const [loadingResetTodo, setLoadingResetTodo] = useState(false);
  const [loadingResetVentas, setLoadingResetVentas] = useState(false);
  const [loadingBackup, setLoadingBackup] = useState(false);
  const [backupTarget, setBackupTarget] = useState<null | "ingresos" | "todo">(null);

  const parseApiBody = (text: string): { error?: string; [k: string]: unknown } => {
    if (!text) return {};
    try {
      return JSON.parse(text) as { error?: string; [k: string]: unknown };
    } catch {
      return { error: text };
    }
  };

  const mensajeApi = (data: Record<string, unknown>) => {
    const parts = [data.error, data.details, data.hint]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return parts.join(" — ");
  };

  const submitBanco = async (event: FormEvent) => {
    event.preventDefault();
    if (!authenticated) return;
    setLoadingBanco(true);
    setBancoStatus("");
    try {
      const res = await fetch("/api/banco-chile/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: bancoFrom || undefined,
          to: bancoTo || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        inserted?: number;
        skipped?: number;
        locked?: number;
        from?: string;
        to?: string;
      };
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar el banco");
      const locked = data.locked ? ` ${data.locked} quedaron en un período cerrado.` : "";
      setBancoStatus(
        `Banco de Chile ${data.from} a ${data.to}: ${data.inserted ?? 0} movimientos nuevos, ${data.skipped ?? 0} ya estaban.${locked}`,
      );
      invalidateMainNavCaches();
    } catch (error) {
      setBancoStatus(error instanceof Error ? error.message : "No se pudo actualizar el banco");
    } finally {
      setLoadingBanco(false);
    }
  };

  const descargarRespaldo = useCallback(async (kind: "ingresos" | "todo"): Promise<boolean> => {
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
      const match = cd?.match(/filename="([^"]+)"/i);
      if (match?.[1]) filename = match[1];
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(`Respaldo descargado (${filename}). Confirma el siguiente paso para borrar los datos.`);
      return true;
    } catch {
      setStatus("Error de red al generar el respaldo");
      return false;
    } finally {
      setLoadingBackup(false);
      setBackupTarget(null);
    }
  }, []);

  const borrarTodosLosIngresos = async () => {
    if (!authenticated) return;
    const ok1 = window.confirm(
      "Paso 1 de 2: se descargará un respaldo de todos los ingresos.\n\n¿Continuar?",
    );
    if (!ok1) return;
    const backupOk = await descargarRespaldo("ingresos");
    if (!backupOk) return;
    const ok2 = window.confirm(
      "Paso 2 de 2: ¿Confirmar eliminación definitiva de todos los ingresos? Los egresos no se borran.",
    );
    if (!ok2) return;
    setLoadingResetVentas(true);
    setStatus("");
    try {
      const res = await fetch("/api/ventas/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "No se pudo borrar los ingresos");
        return;
      }
      setStatus("Movimientos de ingreso eliminados.");
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
      "Paso 1 de 2: se descargará un respaldo de todos los movimientos.\n\n¿Continuar?",
    );
    if (!ok1) return;
    const backupOk = await descargarRespaldo("todo");
    if (!backupOk) return;
    const ok2 = window.confirm(
      "Paso 2 de 2: ¿Confirmar eliminación definitiva de gastos, ingresos e historial de importaciones?",
    );
    if (!ok2) return;
    setLoadingResetTodo(true);
    setStatus("");
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

  const borradoBusy = loadingBackup || loadingResetVentas || loadingResetTodo;

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
          Tu cuenta tiene acceso de solo lectura. Solo el administrador de la organización puede actualizar el banco o borrar datos.
        </p>
      </main>
    );
  }

  return (
    <main className="page-main page-main--md">
      <p className="text-sm text-slate-600">
        Los gastos e ingresos entran por Fudo y por los bancos. Aquí queda la actualización del Banco de Chile.
      </p>

      <section
        aria-label="Períodos cerrados"
        className="rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-3 text-sm text-slate-800"
      >
        <h2 className="font-semibold text-indigo-950">Períodos cerrados</h2>
        <p className="mt-2 text-slate-700">
          Un mes o un año cerrado no recibe movimientos nuevos de Fudo ni de los bancos.{" "}
          <a href="/periodos-cerrados" className="font-medium text-indigo-800 underline">
            Gestionar períodos cerrados
          </a>
          .
        </p>
      </section>

      <section className="ui-card p-6">
        <h2 className="text-lg font-semibold">Banco de Chile</h2>
        <p className="mt-2 text-sm text-slate-600">
          Trae la cartola de la cuenta corriente. Si el movimiento ya existe, no se duplica. Si no eliges fechas, usa los últimos 7 días.
        </p>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => void submitBanco(event)}
        >
          <label className="text-sm text-slate-600">
            Desde
            <input
              type="date"
              className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2"
              value={bancoFrom}
              onChange={(event) => setBancoFrom(event.target.value)}
              disabled={!ready || !authenticated || loadingBanco}
            />
          </label>
          <label className="text-sm text-slate-600">
            Hasta
            <input
              type="date"
              className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2"
              value={bancoTo}
              onChange={(event) => setBancoTo(event.target.value)}
              disabled={!ready || !authenticated || loadingBanco}
            />
          </label>
          <button type="submit" className="ui-btn-primary" disabled={!authenticated || loadingBanco}>
            {loadingBanco ? "Actualizando..." : "Actualizar Banco de Chile"}
          </button>
        </form>
        {bancoStatus ? <p className="mt-3 text-sm text-slate-700">{bancoStatus}</p> : null}
      </section>

      {status ? <p className="ui-card px-4 py-3 text-sm text-slate-700">{status}</p> : null}

      <section className="rounded-xl border border-rose-900/50 bg-slate-50 p-6">
        <h2 className="font-semibold text-rose-900">Borrar datos</h2>
        <p className="mt-2 text-sm text-slate-600">
          Antes de borrar se descarga un respaldo y hay que confirmar en dos pasos.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!authenticated || borradoBusy}
            className="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            onClick={() => void borrarTodosLosIngresos()}
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
                : "Borrar todos los movimientos"}
          </button>
        </div>
      </section>
    </main>
  );
}
