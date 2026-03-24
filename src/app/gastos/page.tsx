"use client";

import { useEffect, useState } from "react";

type GastoRow = {
  fecha: string;
  origen: string;
  id: string;
  nroOperacion: string;
  nombreDestino: string;
  descripcion: string;
  monto: number;
  concepto: string;
};

const formatClp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n || 0);

export default function GastosPage() {
  const [rows, setRows] = useState<GastoRow[]>([]);
  const [status, setStatus] = useState("Cargando detalle de gastos...");

  useEffect(() => {
    fetch("/api/gastos/detalle")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "No se pudo cargar detalle");
        }
        setRows(data.rows ?? []);
        setStatus("");
      })
      .catch((e: Error) => {
        setStatus(e.message);
      });
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-10">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold">Detalle de gastos</h1>
        <p className="mt-2 text-sm text-slate-300">
          Vista base para definir reglas de interpretación de datos.
        </p>
      </section>

      {status ? (
        <p className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {status}
        </p>
      ) : null}

      <section className="overflow-auto rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-950 text-left">
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Origen</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">N° Operación</th>
              <th className="px-3 py-2">Nombre Destino</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2">Concepto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-800">
                <td className="px-3 py-2">{row.fecha}</td>
                <td className="px-3 py-2">{row.origen}</td>
                <td className="px-3 py-2">{row.id}</td>
                <td className="px-3 py-2">{row.nroOperacion}</td>
                <td className="px-3 py-2">{row.nombreDestino}</td>
                <td className="px-3 py-2">{row.descripcion}</td>
                <td className="px-3 py-2 text-right">{formatClp(row.monto)}</td>
                <td className="px-3 py-2">{row.concepto}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Sin gastos disponibles.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
