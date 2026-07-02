"use client";

import { useState } from "react";

export function SetupBootstrapButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const onClick = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/setup/bootstrap", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "No se pudo crear la organización.");
      } else {
        setMessage(data.message || "Organización inicial creada correctamente.");
      }
    } catch {
      setMessage("Error de conexión al crear organización.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="shrink-0 rounded-xl bg-gradient-to-r from-[#6366f1] to-[#2277ff] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-[#4f46e5] hover:to-[#0056ff] disabled:opacity-60"
      >
        {loading ? "Creando organización…" : "Crear organización inicial"}
      </button>
      {message ? (
        <p className="max-w-xs text-right text-xs text-slate-600">{message}</p>
      ) : null}
    </div>
  );
}
