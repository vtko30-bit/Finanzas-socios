import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { isMissingRpcError } from "@/lib/supabase-rpc-fallback";

function lastDayOfCalendarMonth(yearMonth: string): string {
  const [ys, ms] = yearMonth.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m) return `${yearMonth}-28`;
  const last = new Date(y, m, 0).getDate();
  return `${yearMonth}-${String(last).padStart(2, "0")}`;
}

/** Misma lógica que `dashboard_metrics` en SQL (ingreso vs resto). */
function aggregateAmounts(
  rows: { amount: unknown; type: string }[] | null,
): { income: number; expense: number; count: number } {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const r of rows ?? []) {
    count++;
    const amt = Number(r.amount) || 0;
    if (r.type === "income") income += amt;
    else expense += amt;
  }
  return { income, expense, count };
}

async function dashboardMetricsFallback(
  supabase: SupabaseClient,
  orgId: string,
  monthStart: string,
  monthEnd: string,
) {
  const { data: monthRows, error: e1 } = await supabase
    .from("transactions")
    .select("amount, type")
    .eq("organization_id", orgId)
    .eq("flow_kind", "operativo")
    .gte("date", monthStart)
    .lte("date", monthEnd);

  if (e1) throw e1;

  const { data: totalRows, error: e2 } = await supabase
    .from("transactions")
    .select("amount, type")
    .eq("organization_id", orgId)
    .eq("flow_kind", "operativo");

  if (e2) throw e2;

  return {
    month: aggregateAmounts(monthRows),
    total: aggregateAmounts(totalRows),
  };
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

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = `${yearMonth}-01`;
  const monthEnd = lastDayOfCalendarMonth(yearMonth);

  const rpc = await supabase.rpc("dashboard_metrics", {
    p_org_id: member.organization_id,
    p_month_start: monthStart,
    p_month_end: monthEnd,
  });

  let raw: unknown = rpc.data;
  if (rpc.error) {
    if (isMissingRpcError(rpc.error.message)) {
      try {
        raw = await dashboardMetricsFallback(
          supabase,
          member.organization_id,
          monthStart,
          monthEnd,
        );
      } catch {
        return NextResponse.json({ error: rpc.error.message }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: rpc.error.message }, { status: 500 });
    }
  }

  const payload = raw as {
    month?: { income?: unknown; expense?: unknown; count?: unknown };
    total?: { income?: unknown; expense?: unknown; count?: unknown };
  };

  const monthTotals = {
    income: Number(payload.month?.income) || 0,
    expense: Number(payload.month?.expense) || 0,
    count: Number(payload.month?.count) || 0,
  };
  const totalTotals = {
    income: Number(payload.total?.income) || 0,
    expense: Number(payload.total?.expense) || 0,
    count: Number(payload.total?.count) || 0,
  };

  return NextResponse.json({
    month: {
      ...monthTotals,
      net: monthTotals.income - monthTotals.expense,
    },
    total: {
      ...totalTotals,
      net: totalTotals.income - totalTotals.expense,
    },
  });
}
