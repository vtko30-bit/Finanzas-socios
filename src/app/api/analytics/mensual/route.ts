import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

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
    .select("date, type, amount")
    .eq("organization_id", member.organization_id)
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byMonth = new Map<string, { ingresos: number; gastos: number }>();

  for (const row of data ?? []) {
    const d = String(row.date || "");
    const key = d.length >= 7 ? d.slice(0, 7) : "";
    if (!key) continue;
    if (!byMonth.has(key)) {
      byMonth.set(key, { ingresos: 0, gastos: 0 });
    }
    const bucket = byMonth.get(key)!;
    const amt = Number(row.amount) || 0;
    if (row.type === "income") bucket.ingresos += amt;
    else bucket.gastos += amt;
  }

  const monthly = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, v]) => ({
      periodo,
      ingresos: v.ingresos,
      gastos: v.gastos,
      neto: v.ingresos - v.gastos,
    }));

  const years = new Set<string>();
  monthly.forEach((m) => years.add(m.periodo.slice(0, 4)));

  return NextResponse.json({
    monthly,
    years: Array.from(years).sort(),
  });
}
