"use client";

import { useEffect, useState } from "react";

type Level = "green" | "yellow" | "red";

type StatusResponse = {
  level: Level;
  message: string;
  role?: string;
};

const levelStyles: Record<Level, string> = {
  green: "border-emerald-300 bg-emerald-50 text-emerald-950",
  yellow: "border-amber-300 bg-amber-50 text-amber-950",
  red: "border-rose-300 bg-rose-50 text-rose-950",
};

const labels: Record<Level, string> = {
  green: "Semaforo: Verde",
  yellow: "Semaforo: Amarillo",
  red: "Semaforo: Rojo",
};

export function HomeHealthStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/session-status")
      .then((res) => res.json())
      .then((data: StatusResponse) => setStatus(data))
      .catch(() =>
        setStatus({
          level: "red",
          message: "No se pudo verificar estado de sesión.",
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <p className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
        Verificando estado general...
      </p>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${levelStyles[status.level]}`}>
      <p className="font-medium">{labels[status.level]}</p>
      <p>{status.message}</p>
    </div>
  );
}
