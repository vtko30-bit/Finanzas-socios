import { NextResponse } from "next/server";
import {
  buildMonthLabels,
  isoDateOk,
  loadResumenPivotMain,
  loadResumenPivotPorSucursal,
  monthKeysInRange,
} from "@/lib/resumen-pivot-core";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

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

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get("desde")?.trim() ?? "";
  const hasta = searchParams.get("hasta")?.trim() ?? "";
  const sucursal = searchParams.get("sucursal")?.trim() ?? "";
  const ventasPorSucursal =
    searchParams.get("ventasPorSucursal") === "1" ||
    searchParams.get("ventasPorSucursal") === "true";
  const soloSucursalesFijas =
    searchParams.get("soloSucursalesFijas") === "1" ||
    searchParams.get("soloSucursalesFijas") === "true";

  if (!isoDateOk(desde) || !isoDateOk(hasta)) {
    return NextResponse.json(
      { error: "Parámetros desde y hasta requeridos (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  if (desde > hasta) {
    return NextResponse.json(
      { error: "La fecha desde no puede ser posterior a hasta" },
      { status: 400 },
    );
  }

  const monthKeys = monthKeysInRange(desde, hasta);
  const monthLabels = buildMonthLabels(monthKeys);

  if (monthKeys.length === 0) {
    return NextResponse.json({
      desde,
      hasta,
      monthKeys: [],
      monthLabels: [] as string[],
      ventas: { rows: [] },
      desgloseVentasPorSucursal: false,
      ventasPorSucursalLista: [],
      gastosPorSucursalLista: [],
      gastos: { rows: [] },
      gastosSocios: { rows: [] },
      creditos: { rows: [] },
    });
  }

  if (ventasPorSucursal) {
    const { data, error } = await loadResumenPivotPorSucursal({
      supabase,
      organizationId: member.organization_id,
      desde,
      hasta,
      soloSucursalesFijas,
    });

    if (error || !data) {
      return NextResponse.json({ error: error ?? "Error resumen" }, { status: 500 });
    }

    return NextResponse.json({
      desde: data.desde,
      hasta: data.hasta,
      sucursalFiltro: null,
      desgloseVentasPorSucursal: true,
      monthKeys: data.monthKeys,
      monthLabels: data.monthLabels,
      ventas: { rows: [] },
      ventasPorSucursalLista: data.ventasPorSucursalLista,
      gastos: { rows: [] },
      gastosPorSucursalLista: data.gastosPorSucursalLista,
      gastosSocios: { rows: data.gastosSocios.rows },
      creditos: { rows: data.creditos.rows },
    });
  }

  const { data, error } = await loadResumenPivotMain({
    supabase,
    organizationId: member.organization_id,
    desde,
    hasta,
    sucursal,
    soloSucursalesFijas,
  });

  if (error || !data) {
    return NextResponse.json({ error: error ?? "Error resumen" }, { status: 500 });
  }

  return NextResponse.json({
    desde: data.desde,
    hasta: data.hasta,
    sucursalFiltro: data.sucursalFiltro,
    desgloseVentasPorSucursal: false,
    ventasPorSucursalLista: [],
    gastosPorSucursalLista: [],
    monthKeys: data.monthKeys,
    monthLabels: data.monthLabels,
    ventas: data.ventas,
    gastos: data.gastos,
    gastosSocios: data.gastosSocios,
    creditos: data.creditos,
  });
}
