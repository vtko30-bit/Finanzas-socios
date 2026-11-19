"use client";

import { FormEvent, useEffect, useState } from "react";

type FamilyOption = { id: string; name: string };

type GastoRecurrenteModalProps = {
  gasto: {
    id: string;
    fecha: string;
    monto: number;
    nombreDestino: string;
    descripcion: string;
    familia: string | null;
  };
  onClose: () => void;
  onCreated: (message: string) => void;
};

const formatCLP = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

function dayFromFecha(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha.trim());
  if (!m) return "5";
  const day = Number(m[3]);
  if (!Number.isFinite(day) || day < 1 || day > 31) return "5";
  return String(day);
}

export function GastoRecurrenteModal({
  gasto,
  onClose,
  onCreated,
}: GastoRecurrenteModalProps) {
  const defaultName =
    (gasto.nombreDestino || "").trim() ||
    (gasto.descripcion || "").trim() ||
    "Pago recurrente";
  const [name, setName] = useState(defaultName);
  const [dayOfMonth, setDayOfMonth] = useState(dayFromFecha(gasto.fecha));
  const [amountEstimate, setAmountEstimate] = useState(
    String(Math.round(Math.abs(gasto.monto) || 0) || ""),
  );
  const [familyId, setFamilyId] = useState("");
  const [matchText, setMatchText] = useState(
    (gasto.nombreDestino || "").trim() || (gasto.descripcion || "").trim(),
  );
  const [notes, setNotes] = useState("");
  const [reminderDays, setReminderDays] = useState("3");
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/familias");
      const body = (await res.json().catch(() => ({}))) as {
        families?: Array<{ id: string; name: string }>;
      };
      if (cancelled || !res.ok) return;
      const list = (body.families ?? []).map((f) => ({
        id: f.id,
        name: f.name,
      }));
      setFamilies(list);
      const famName = (gasto.familia || "").trim().toLowerCase();
      if (famName) {
        const match = list.find(
          (f) => f.name.trim().toLowerCase() === famName,
        );
        if (match) setFamilyId(match.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gasto.familia]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const amountTrim = amountEstimate.trim();
      const res = await fetch("/api/pagos-recurrentes/from-gasto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: gasto.id,
          name: name.trim(),
          day_of_month: Number(dayOfMonth),
          amount_estimate: amountTrim ? Number(amountTrim) : null,
          family_id: familyId || null,
          match_text: matchText.trim(),
          notes: notes.trim(),
          reminder_days_before: Number(reminderDays),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        obligation?: { name?: string };
      };
      if (!res.ok) {
        setError(body.error || "No se pudo crear el pago recurrente.");
        return;
      }
      const label = body.obligation?.name || name.trim();
      onCreated(
        `“${label}” quedó como pago recurrente y este mes como pagado.`,
      );
    } catch {
      setError("Error de red al guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gasto-recurrente-titulo"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-300 bg-slate-50 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="gasto-recurrente-titulo"
          className="text-base font-semibold text-slate-900"
        >
          Marcar como pago recurrente
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Gasto {formatCLP(gasto.monto)} · {gasto.fecha}
          {gasto.nombreDestino ? ` · ${gasto.nombreDestino}` : ""}. Se crea la
          obligación y este mes queda pagado con este movimiento.
        </p>

        <div className="mt-4 grid gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Nombre</span>
            <input
              className="ui-field w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={busy}
              placeholder="Arriendo, Luz, Internet…"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Día del mes</span>
            <input
              type="number"
              min={1}
              max={31}
              className="ui-field w-full"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">
              Monto estimado (opcional)
            </span>
            <input
              type="number"
              min={0}
              className="ui-field w-full"
              value={amountEstimate}
              onChange={(e) => setAmountEstimate(e.target.value)}
              disabled={busy}
              placeholder="Vacío si varía cada mes"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Familia</span>
            <select
              className="ui-field w-full"
              value={familyId}
              onChange={(e) => setFamilyId(e.target.value)}
              disabled={busy}
            >
              <option value="">Sin familia</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">
              Texto para detectar en importaciones
            </span>
            <input
              className="ui-field w-full"
              value={matchText}
              onChange={(e) => setMatchText(e.target.value)}
              disabled={busy}
              placeholder="Ej. ENEL, Metrogas, arriendo"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Notas</span>
            <input
              className="ui-field w-full"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Avisar días antes</span>
            <input
              type="number"
              min={0}
              max={30}
              className="ui-field w-full"
              value={reminderDays}
              onChange={(e) => setReminderDays(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="ui-btn-secondary ui-btn-sm"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="ui-btn-primary ui-btn-sm"
            disabled={busy}
          >
            {busy ? "Guardando…" : "Crear y marcar pagado"}
          </button>
        </div>
      </form>
    </div>
  );
}
