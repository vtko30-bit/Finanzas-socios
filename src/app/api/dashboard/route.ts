import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { isMissingRpcError } from "@/lib/supabase-rpc-fallback";
import { fudoCuentaEnResultado } from "@/lib/fudo-cuenta-en-resultado";

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
  rows: { amount: unknown; type: string; source?: unknown; payment_method?: unknown }[] | null,
): { income: number; expense: number; count: number } {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const r of rows ?? []) {
    if (!fudoCuentaEnResultado(r.source, r.payment_method)) continue;
    count++;
    const amt = Number(r.amount) || 0;
    if (r.type === "income") income += amt;
    else expense += amt;
  }
  return { income, expense, count };
}

async function fetchOperativoPaged(
  supabase: SupabaseClient,
  orgId: string,
  range?: { from: string; to: string },
) {
  const out: { amount: unknown; type: string; source?: unknown; payment_method?: unknown }[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    let q = supabase
      .from("transactions")
      .select("amount, type, source, payment_method")
      .eq("organization_id", orgId)
      .eq("flow_kind", "operativo")
      .or("credit_id.is.null,source.eq.creditos")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (range) q = q.gte("date", range.from).lte("date", range.to);
    const { data, error } = await q;
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function dashboardMetricsFallback(
  supabase: SupabaseClient,
  orgId: string,
  monthStart: string,
  monthEnd: string,
) {
  const [monthRows, totalRows] = await Promise.all([
    fetchOperativoPaged(supabase, orgId, { from: monthStart, to: monthEnd }),
    fetchOperativoPaged(supabase, orgId),
  ]);
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

  const reglaFudo = await supabase.rpc("fudo_cuenta_en_resultado", {
    p_source: "banco",
    p_payment_method: "transferencia",
  });
  const rpc = reglaFudo.error
    ? { data: null, error: reglaFudo.error }
    : await supabase.rpc("dashboard_metrics", {
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
