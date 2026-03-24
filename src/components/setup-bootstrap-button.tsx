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
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded-md border border-slate-600 px-3 py-2 text-sm hover:border-sky-500 disabled:opacity-60"
      >
        {loading ? "Creando organización..." : "Crear organización inicial"}
      </button>
      {message ? <p className="text-xs text-slate-300">{message}</p> : null}
    </div>
  );
}
