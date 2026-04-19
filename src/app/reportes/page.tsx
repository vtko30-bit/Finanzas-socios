"use client";

import { useMemo, useState } from "react";
import { useAuthState } from "@/hooks/use-auth-state";
import { REPORTE_VISTAS, type ReporteVista } from "@/lib/reportes-vistas";

const VISTA_LABEL: Record<ReporteVista, string> = {
  movimientos: "Movimientos (todas las transacciones)",
  resumen: "Resumen (agrupado como en la pantalla Resumen)",
  familias: "Familias (catálogo)",
  categorias: "Categorías (catálogo + solo planilla)",
  ventas: "Ventas (ingresos)",
  gastos: "Gastos (egresos)",
  excluidos: "Excluidos (ingresos y gastos en familias excluidas)",
  socios: "Socios (gastos familias Mario / Mena / Victor)",
};

export default function ReportesPage() {
  const { ready, authenticated } = useAuthState();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [type, setType] = useState("all");
  const [vista, setVista] = useState<ReporteVista>("movimientos");
  const [resumenPorSucursal, setResumenPorSucursal] = useState(false);

  const filtroTipoAplica = vista === "movimientos";

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("vista", vista);
    if (vista === "resumen" || vista === "movimientos" || vista === "ventas" || vista === "gastos" || vista === "excluidos" || vista === "socios") {
      params.set("from", from);
      params.set("to", to);
    }
    if (filtroTipoAplica && type !== "all") params.set("type", type);
    if (vista === "resumen" && resumenPorSucursal) params.set("resumenPorSucursal", "1");
    return params.toString();
  }, [from, to, type, vista, filtroTipoAplica, resumenPorSucursal]);

  const requiereRangoFechas =
    vista === "resumen" ||
    vista === "movimientos" ||
    vista === "ventas" ||
    vista === "gastos" ||
    vista === "excluidos" ||
    vista === "socios";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <section className="rounded-xl border border-slate-200/90 bg-white/90 p-6 shadow-md backdrop-blur-sm">
        <h1 className="text-xl font-semibold">Reportes y descargas</h1>
        {!ready ? (
          <p className="mt-3 text-xs text-slate-600">Verificando sesión...</p>
        ) : null}
        {ready && !authenticated ? (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Debes iniciar sesión para exportar reportes.
          </p>
        ) : null}

        <label className="mt-4 block text-sm">
          Vista a exportar
          <select
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
            value={vista}
            onChange={(e) => setVista(e.target.value as ReporteVista)}
            disabled={!authenticated}
          >
            {REPORTE_VISTAS.map((v) => (
              <option key={v} value={v}>
                {VISTA_LABEL[v]}
              </option>
            ))}
          </select>
        </label>

        <p className="mt-2 text-xs text-slate-600">
          En movimientos, ventas, gastos y “Todos” verás columnas{" "}
          <strong>tipo_movimiento</strong> (Ingreso/Gasto), <strong>familia</strong>,{" "}
          <strong>categoria</strong>, valor importado en{" "}
          <strong>medio_pago_valor_importado</strong> y en{" "}
          <strong>medio_pago_resumen</strong> la misma heurística que el resumen por forma de
          pago (ingresos); en gastos, si el valor es solo un código numérico largo, se indica
          como tal para que compares con el valor importado.
        </p>

        {vista === "resumen" ? (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={resumenPorSucursal}
              onChange={(e) => setResumenPorSucursal(e.target.checked)}
              disabled={!authenticated}
            />
            <span>
              Incluir desglose por sucursal (agrupa por <strong>origen de cuenta</strong>, igual
              que el resumen con desglose por sucursal en la app). En CSV se añade una segunda
              tabla; en XLSX una hoja <strong>Por sucursal</strong> además del consolidado.
            </span>
          </label>
        ) : null}

        {requiereRangoFechas ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Desde
              <input
                type="date"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={!authenticated}
              />
            </label>
            <label className="text-sm">
              Hasta
              <input
                type="date"
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={!authenticated}
              />
            </label>
          </div>
        ) : null}

        {filtroTipoAplica ? (
          <label className="mt-4 block text-sm">
            Tipo (solo movimientos)
            <select
              className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={!authenticated}
            >
              <option value="all">Todos</option>
              <option value="income">Solo ingresos</option>
              <option value="expense">Solo gastos</option>
            </select>
          </label>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={authenticated ? `/api/reportes/csv?${query}` : "#"}
            aria-disabled={!authenticated}
            onClick={(e) => {
              if (!authenticated) e.preventDefault();
            }}
            className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            Descargar CSV
          </a>
          <a
            href={authenticated ? `/api/reportes/xlsx?${query}` : "#"}
            aria-disabled={!authenticated}
            onClick={(e) => {
              if (!authenticated) e.preventDefault();
            }}
            className="rounded-md border border-slate-300 px-4 py-2 font-medium disabled:opacity-60"
          >
            Descargar XLSX
          </a>
        </div>
      </section>
    </main>
  );
}
