import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getUserOrganization } from "@/lib/organization";
import {
  CATEGORIAS_CSV_HEADERS,
  escapeCsv,
  fetchCategoriasInventarioParaExporte,
  fetchFamiliasParaExporte,
  fetchTransaccionesParaExporte,
  FAMILIAS_CSV_HEADERS,
  filaMovimientoParaCsv,
  flattenResumenParaFilas,
  flattenResumenPorSucursalParaFilas,
  headersResumenCsv,
  headersResumenPorSucursalCsv,
  MOVIMIENTOS_CSV_HEADERS,
  parseReporteVista,
  type ReporteVista,
} from "@/lib/reportes-export";
import {
  isoDateOk,
  loadResumenPivotMain,
  loadResumenPivotPorSucursal,
} from "@/lib/resumen-pivot-core";
import { createClient } from "@/lib/supabase/server";

function nombreArchivo(vista: ReporteVista): string {
  const slug: Record<ReporteVista, string> = {
    movimientos: "movimientos",
    resumen: "resumen",
    familias: "familias",
    categorias: "categorias",
    ventas: "ventas",
    gastos: "gastos",
    excluidos: "excluidos",
    socios: "socios",
  };
  return `reporte-${slug[vista]}.csv`;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const member = await getUserOrganization(supabase, user.id);
  if (!member) {
    return NextResponse.json({ error: "Sin organización" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vista = parseReporteVista(url.searchParams.get("vista"));
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const type = url.searchParams.get("type");
  const resumenPorSucursal =
    url.searchParams.get("resumenPorSucursal") === "1" ||
    url.searchParams.get("resumenPorSucursal") === "true";

  let csv = "";
  let rowCount = 0;

  if (vista === "resumen") {
    if (!from || !to || !isoDateOk(from) || !isoDateOk(to)) {
      return NextResponse.json(
        { error: "Para Resumen indique desde y hasta (YYYY-MM-DD) válidos." },
        { status: 400 },
      );
    }
    if (from > to) {
      return NextResponse.json(
        { error: "La fecha desde no puede ser posterior a hasta." },
        { status: 400 },
      );
    }
    const { data, error } = await loadResumenPivotMain({
      supabase,
      organizationId: member.organization_id,
      desde: from,
      hasta: to,
    });
    if (error || !data) {
      return NextResponse.json(
        { error: error ?? "Error al generar resumen" },
        { status: 500 },
      );
    }
    const flat = flattenResumenParaFilas(data);
    rowCount = flat.length;
    const headers = headersResumenCsv(data.monthKeys);
    const lines = [headers.join(",")];
    for (const rec of flat) {
      lines.push(headers.map((h) => escapeCsv(rec[h])).join(","));
    }
    if (resumenPorSucursal) {
      const { data: ps, error: psErr } = await loadResumenPivotPorSucursal({
        supabase,
        organizationId: member.organization_id,
        desde: from,
        hasta: to,
      });
      if (psErr || !ps) {
        return NextResponse.json(
          { error: psErr ?? "Error al generar desglose por sucursal" },
          { status: 500 },
        );
      }
      const flatPs = flattenResumenPorSucursalParaFilas(ps);
      rowCount += flatPs.length;
      lines.push("");
      const h2 = headersResumenPorSucursalCsv(data.monthKeys);
      lines.push(h2.join(","));
      for (const rec of flatPs) {
        lines.push(h2.map((h) => escapeCsv(rec[h])).join(","));
      }
    }
    csv = lines.join("\n");
  } else if (vista === "familias") {
    const { rows, error } = await fetchFamiliasParaExporte({
      supabase,
      organizationId: member.organization_id,
    });
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    rowCount = rows.length;
    const lines = [FAMILIAS_CSV_HEADERS.join(",")];
    for (const r of rows) {
      lines.push(
        [r.id, r.nombre, r.orden].map(escapeCsv).join(","),
      );
    }
    csv = lines.join("\n");
  } else if (vista === "categorias") {
    const { rows, error } = await fetchCategoriasInventarioParaExporte({
      supabase,
      organizationId: member.organization_id,
    });
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    rowCount = rows.length;
    const lines = [CATEGORIAS_CSV_HEADERS.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.concept_id,
          r.categoria,
          r.familia_id,
          r.familia,
          r.solo_planilla,
        ]
          .map(escapeCsv)
          .join(","),
      );
    }
    csv = lines.join("\n");
  } else {
    const typeFilter =
      type === "income" || type === "expense" ? type : "all";
    const { rows, error } = await fetchTransaccionesParaExporte({
      supabase,
      organizationId: member.organization_id,
      from,
      to,
      typeFilter,
      vista,
    });
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    rowCount = rows.length;
    const lines = [MOVIMIENTOS_CSV_HEADERS.join(",")];
    for (const row of rows) {
      const rec = filaMovimientoParaCsv(row);
      lines.push(MOVIMIENTOS_CSV_HEADERS.map((h) => escapeCsv(rec[h])).join(","));
    }
    csv = lines.join("\n");
  }

  await logAudit(supabase, {
    organization_id: member.organization_id,
    actor_user_id: user.id,
    action: "export_csv",
    entity_type: "report",
    entity_id: `report_${vista}`,
    changes_json: {
      vista,
      from,
      to,
      type,
      resumenPorSucursal: vista === "resumen" ? resumenPorSucursal : undefined,
      rows: rowCount,
    },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivo(vista)}"`,
    },
  });
}
