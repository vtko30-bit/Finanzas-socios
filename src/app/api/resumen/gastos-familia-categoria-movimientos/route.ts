import { NextResponse } from "next/server";
import { isoDateOk, loadGastosFamiliaCategoriaMovimientos } from "@/lib/resumen-pivot-core";
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
  const familia = searchParams.get("familia")?.trim() ?? "";
  const categoria = searchParams.get("categoria")?.trim() ?? "";
  const alcanceRaw = searchParams.get("alcance")?.trim().toLowerCase() ?? "";
  const sucursal = searchParams.get("sucursal")?.trim() ?? "";
  const origenCuentaBloque = searchParams.get("origen_cuenta_bloque")?.trim() ?? "";
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

  if (!familia) {
    return NextResponse.json({ error: "Parámetro familia requerido" }, { status: 400 });
  }

  if (!categoria) {
    return NextResponse.json({ error: "Parámetro categoria requerido" }, { status: 400 });
  }

  const alcance = alcanceRaw === "socios" ? "socios" : alcanceRaw === "negocio" ? "negocio" : null;
  if (!alcance) {
    return NextResponse.json(
      { error: "Parámetro alcance debe ser negocio o socios" },
      { status: 400 },
    );
  }

  const { data, error } = await loadGastosFamiliaCategoriaMovimientos({
    supabase,
    organizationId: member.organization_id,
    desde,
    hasta,
    familia,
    alcance,
    sucursal,
    soloSucursalesFijas,
    origenCuentaBloque: origenCuentaBloque || null,
    categoria,
  });

  if (error || !data) {
    return NextResponse.json({ error: error ?? "Error al cargar movimientos" }, { status: 500 });
  }

  return NextResponse.json({
    desde,
    hasta,
    sucursalFiltro: sucursal || null,
    soloSucursalesFijas,
    familia,
    alcance,
    categoria,
    movimientos: data.movimientos,
  });
}
