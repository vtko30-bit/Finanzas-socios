import { NextResponse } from "next/server";
import { loadAnalyticsMonthly } from "@/lib/analytics-monthly";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { esSucursalResumenCanonica } from "@/lib/sucursal-resumen";

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

  const sucursal = new URL(request.url).searchParams.get("sucursal")?.trim() ?? "";
  if (sucursal && !esSucursalResumenCanonica(sucursal)) {
    return NextResponse.json({ error: "Sucursal no válida" }, { status: 400 });
  }

  try {
    const { monthly, years } = await loadAnalyticsMonthly({
      supabase,
      organizationId: member.organization_id,
      sucursal,
    });
    return NextResponse.json({ monthly, years });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al cargar análisis";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
