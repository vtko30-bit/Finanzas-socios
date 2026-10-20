import { NextResponse } from "next/server";
import { loadFudoRange } from "@/lib/fudo/load-range";
import { createRgSuiteAdmin, rgSuiteOrganizationId } from "@/lib/fudo/rg-suite";
import { getUserOrganization } from "@/lib/organization";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const member = await getUserOrganization(supabase, user.id);
  if (!member) return NextResponse.json({ error: "Sin organización" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from")?.trim() ?? "";
  const to = searchParams.get("to")?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: "Fechas inválidas" }, { status: 400 });
  }

  try {
    const organizationId = await rgSuiteOrganizationId();
    const data = await loadFudoRange({ organizationId, from, to });
    const admin = createRgSuiteAdmin();
    const { data: runs, error } = await admin
      .schema("fudo")
      .from("sync_runs")
      .select("id, from_date, to_date, status, trigger, error, finished_at, started_at")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(6);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ...data, runs: runs ?? [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo cargar Fudo" },
      { status: 500 },
    );
  }
}
