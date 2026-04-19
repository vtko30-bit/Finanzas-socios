import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getUserOrganization } from "@/lib/organization";
import {
  CATEGORIAS_CSV_HEADERS,
  fetchCategoriasInventarioParaExporte,
  fetchFamiliasParaExporte,
  fetchTransaccionesParaExporte,
  FAMILIAS_CSV_HEADERS,
  filaMovimientoParaCsv,
  flattenResumenParaFilas,
  flattenResumenPorSucursalParaFilas,
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
  return `reporte-${slug[vista]}.xlsx`;
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

  const wb = XLSX.utils.book_new();
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
    const wsCons = XLSX.utils.json_to_sheet(flat);
    XLSX.utils.book_append_sheet(
      wb,
      wsCons,
      resumenPorSucursal ? "Consolidado" : "Resumen",
    );
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
      const wsPs = XLSX.utils.json_to_sheet(flatPs);
      XLSX.utils.book_append_sheet(wb, wsPs, "Por sucursal");
    }
  } else if (vista === "familias") {
    const { rows, error } = await fetchFamiliasParaExporte({
      supabase,
      organizationId: member.organization_id,
    });
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    rowCount = rows.length;
    const asObj = rows.map((r) => ({
      [FAMILIAS_CSV_HEADERS[0]]: r.id,
      [FAMILIAS_CSV_HEADERS[1]]: r.nombre,
      [FAMILIAS_CSV_HEADERS[2]]: r.orden,
    }));
    const ws = XLSX.utils.json_to_sheet(asObj);
    XLSX.utils.book_append_sheet(wb, ws, "Familias");
  } else if (vista === "categorias") {
    const { rows, error } = await fetchCategoriasInventarioParaExporte({
      supabase,
      organizationId: member.organization_id,
    });
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    rowCount = rows.length;
    const asObj = rows.map((r) => ({
      [CATEGORIAS_CSV_HEADERS[0]]: r.concept_id,
      [CATEGORIAS_CSV_HEADERS[1]]: r.categoria,
      [CATEGORIAS_CSV_HEADERS[2]]: r.familia_id,
      [CATEGORIAS_CSV_HEADERS[3]]: r.familia,
      [CATEGORIAS_CSV_HEADERS[4]]: r.solo_planilla,
    }));
    const ws = XLSX.utils.json_to_sheet(asObj);
    XLSX.utils.book_append_sheet(wb, ws, "Categorías");
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
    const asObj = rows.map((row) => {
      const rec = filaMovimientoParaCsv(row);
      const o: Record<string, string | number> = {};
      for (const h of MOVIMIENTOS_CSV_HEADERS) {
        o[h] = rec[h];
      }
      return o;
    });
    const nombreHoja =
      vista === "ventas"
        ? "Ventas"
        : vista === "gastos"
          ? "Gastos"
          : vista === "excluidos"
            ? "Excluidos"
            : vista === "socios"
              ? "Socios"
              : "Movimientos";
    const ws = XLSX.utils.json_to_sheet(asObj);
    XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  await logAudit(supabase, {
    organization_id: member.organization_id,
    actor_user_id: user.id,
    action: "export_xlsx",
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

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivo(vista)}"`,
    },
  });
}
