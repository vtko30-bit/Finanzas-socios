"use client";

import { useMemo, useState } from "react";
import { useAuthState } from "@/hooks/use-auth-state";
import { REPORTE_VISTAS, type ReporteVista } from "@/lib/reportes-vistas";
import {
  AuthNotice,
  PageCard,
  PageHeader,
  PageShell,
} from "@/components/ui/page-layout";

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
    if (
      vista === "resumen" ||
      vista === "movimientos" ||
      vista === "ventas" ||
      vista === "gastos" ||
      vista === "excluidos" ||
      vista === "socios"
    ) {
      params.set("from", from);
      params.set("to", to);
    }
    if (filtroTipoAplica && type !== "all") params.set("type", type);
    if (vista === "resumen" && resumenPorSucursal)
      params.set("resumenPorSucursal", "1");
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
    <PageShell size="md">
      <PageHeader
        title="Reportes y descargas"
        description="Exporta datos filtrados en CSV o Excel."
      />

      <PageCard>
        <AuthNotice
          ready={ready}
          authenticated={authenticated}
          message="Debes iniciar sesión para exportar reportes."
        />

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Vista a exportar
          <select
            className="ui-field mt-2"
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

        <p className="mt-2 text-xs text-slate-500">
          En movimientos, ventas, gastos y “Todos” verás columnas{" "}
          <strong>tipo_movimiento</strong> (Ingreso/Gasto), <strong>familia</strong>,{" "}
          <strong>categoria</strong>, valor importado en{" "}
          <strong>medio_pago_valor_importado</strong> y en{" "}
          <strong>medio_pago_resumen</strong> la misma heurística que el resumen por
          forma de pago (ingresos); en gastos, si el valor es solo un código numérico
          largo, se indica como tal para que compares con el valor importado.
        </p>

        {vista === "resumen" ? (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={resumenPorSucursal}
              onChange={(e) => setResumenPorSucursal(e.target.checked)}
              disabled={!authenticated}
            />
            <span>
              Incluir desglose por sucursal (agrupa por{" "}
              <strong>origen de cuenta</strong>, igual que el resumen con desglose por
              sucursal en la app). En CSV se añade una segunda tabla; en XLSX una hoja{" "}
              <strong>Por sucursal</strong> además del consolidado.
            </span>
          </label>
        ) : null}

        {requiereRangoFechas ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Desde
              <input
                type="date"
                className="ui-field mt-2"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={!authenticated}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Hasta
              <input
                type="date"
                className="ui-field mt-2"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={!authenticated}
              />
            </label>
          </div>
        ) : null}

        {filtroTipoAplica ? (
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Tipo (solo movimientos)
            <select
              className="ui-field mt-2"
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

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={authenticated ? `/api/reportes/csv?${query}` : "#"}
            aria-disabled={!authenticated}
            onClick={(e) => {
              if (!authenticated) e.preventDefault();
            }}
            className="ui-btn-primary"
          >
            Descargar CSV
          </a>
          <a
            href={authenticated ? `/api/reportes/xlsx?${query}` : "#"}
            aria-disabled={!authenticated}
            onClick={(e) => {
              if (!authenticated) e.preventDefault();
            }}
            className="ui-btn-secondary"
          >
            Descargar XLSX
          </a>
        </div>
      </PageCard>
    </PageShell>
  );
}
