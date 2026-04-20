import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

function sucursalOrderGroup(name: string): number {
  const t = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (t === "rg" || t.startsWith("rg ") || t.startsWith("rg-")) return 0;
  if (t.includes("happy")) return 1;
  if (t.includes("evento")) return 2;
  return 3;
}

function compareSucursalOrder(a: string, b: string): number {
  const ga = sucursalOrderGroup(a);
  const gb = sucursalOrderGroup(b);
  if (ga !== gb) return ga - gb;
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

/** Valores distintos de origen_cuenta en ingresos y egresos (sucursal / origen en imports). */
export async function GET() {
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

  const { data, error } = await supabase
    .from("transactions")
    .select("origen_cuenta")
    .eq("organization_id", member.organization_id)
    // Compatibilidad con datos históricos previos a flow_kind.
    .or("flow_kind.eq.operativo,flow_kind.is.null")
    .in("type", ["income", "ingreso", "expense", "gasto", "egreso"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const seen = new Set<string>();
  for (const row of data ?? []) {
    const s = String((row as { origen_cuenta?: string | null }).origen_cuenta ?? "").trim();
    if (s) seen.add(s);
  }

  const sucursales = Array.from(seen).sort(compareSucursalOrder);

  return NextResponse.json({ sucursales });
}
