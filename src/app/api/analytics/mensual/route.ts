import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { isMissingRpcError } from "@/lib/supabase-rpc-fallback";

type MonthlyRow = {
  periodo: string;
  ingresos: number;
  gastos: number;
  neto: number;
};

/** Misma lógica que `analytics_monthly_totals` en SQL (agrupado por YYYY-MM). */
async function analyticsMonthlyTotalsFallback(
  supabase: SupabaseClient,
  orgId: string,
): Promise<MonthlyRow[]> {
  const { data: rows, error } = await supabase
    .from("transactions")
    .select("date, amount, type")
    .eq("organization_id", orgId);

  if (error) throw error;

  const byMonth = new Map<string, { ingresos: number; gastos: number }>();

  for (const r of rows ?? []) {
    const dateStr =
      typeof r.date === "string" ? r.date : String(r.date ?? "");
    const periodo = dateStr.length >= 7 ? dateStr.slice(0, 7) : "";
    if (!periodo) continue;

    const amt = Number(r.amount) || 0;
    const ing = r.type === "income" ? amt : 0;
    const gas = r.type === "income" ? 0 : amt;

    const cur = byMonth.get(periodo) ?? { ingresos: 0, gastos: 0 };
    cur.ingresos += ing;
    cur.gastos += gas;
    byMonth.set(periodo, cur);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, v]) => ({
      periodo,
      ingresos: v.ingresos,
      gastos: v.gastos,
      neto: v.ingresos - v.gastos,
    }));
}

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

  const rpc = await supabase.rpc("analytics_monthly_totals", {
    p_org_id: member.organization_id,
  });

  let raw: unknown = rpc.data;
  if (rpc.error) {
    if (isMissingRpcError(rpc.error.message)) {
      try {
        raw = await analyticsMonthlyTotalsFallback(
          supabase,
          member.organization_id,
        );
      } catch {
        return NextResponse.json({ error: rpc.error.message }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: rpc.error.message }, { status: 500 });
    }
  }

  const arr: MonthlyRow[] = Array.isArray(raw) ? (raw as MonthlyRow[]) : [];
  const monthly = arr.map((row) => ({
    periodo: row.periodo,
    ingresos: Number(row.ingresos) || 0,
    gastos: Number(row.gastos) || 0,
    neto: Number(row.neto) || 0,
  }));

  const years = new Set<string>();
  monthly.forEach((m) => {
    if (m.periodo.length >= 4) years.add(m.periodo.slice(0, 4));
  });

  return NextResponse.json({
    monthly,
    years: Array.from(years).sort(),
  });
}
