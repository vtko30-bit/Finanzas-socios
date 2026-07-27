import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { isReconcilableImportSource } from "@/lib/reconcilable-import-source";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(round2(a) - round2(b)) <= 0.02;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function matchesAllTerms(haystack: string, query: string): boolean {
  if (!query) return true;
  const terms = query.split(" ").filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

/**
 * Candidatos a conciliar como pago parcial de un crédito sin cuotas fijas:
 * egresos importados (excel_…) sin credit_id, monto ≤ pendiente.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: creditId } = await context.params;
  const { searchParams } = new URL(request.url);
  const amountRaw = String(searchParams.get("amount") ?? "").trim();
  const amount = amountRaw !== "" ? Number(amountRaw) : NaN;
  const hasAmount = amountRaw !== "" && Number.isFinite(amount) && amount > 0;
  const nameQuery = normalizeSearchText(String(searchParams.get("name") ?? ""));

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
  const orgId = member.organization_id;

  const { data: credit, error: cErr } = await supabase
    .from("credits")
    .select("id, principal, repaid_total, status, total_installments")
    .eq("id", creditId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!credit) {
    return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });
  }
  if (Number(credit.total_installments) !== 0) {
    return NextResponse.json(
      {
        error:
          "Este crédito tiene plan de cuotas. Usa la conciliación por número de cuota.",
      },
      { status: 409 },
    );
  }

  const principal = round2(Number(credit.principal) || 0);
  const repaidSoFar = round2(Number(credit.repaid_total) || 0);
  const remaining = round2(principal - repaidSoFar);
  const expectedAmount = hasAmount ? round2(amount) : null;

  if (remaining <= 0.001) {
    return NextResponse.json({
      expected_amount: expectedAmount,
      credit_status: credit.status,
      pending: 0,
      candidates: [] as Array<{
        id: string;
        date: string;
        amount: number;
        description: string | null;
        source: string | null;
        origen_cuenta: string | null;
        external_ref: string | null;
        counterparty: string | null;
      }>,
    });
  }

  if (expectedAmount != null && expectedAmount > remaining + 0.001) {
    return NextResponse.json(
      {
        error: `El monto supera lo pendiente (${remaining}).`,
        pending: remaining,
      },
      { status: 422 },
    );
  }

  const band = 2;
  const limit = nameQuery ? 2000 : 500;
  const { data: rows, error: qErr } = await supabase
    .from("transactions")
    .select(
      "id, date, amount, counterparty, description, source, origen_cuenta, external_ref, type, flow_kind",
    )
    .eq("organization_id", orgId)
    .eq("flow_kind", "operativo")
    .in("type", EXPENSE_TYPES)
    .is("credit_id", null)
    .gt("amount", 0)
    .lte("amount", remaining + band)
    .order("date", { ascending: false })
    .limit(limit);

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const candidates = (rows ?? [])
    .filter((r) => {
      if (!isReconcilableImportSource(r.source as string | null)) return false;
      const amt = round2(Math.abs(Number(r.amount) || 0));
      if (!(amt > 0 && amt <= remaining + 0.02)) return false;
      if (expectedAmount != null && !amountsMatch(amt, expectedAmount)) return false;
      if (nameQuery) {
        const hay = normalizeSearchText(
          `${r.counterparty ?? ""} ${r.description ?? ""}`,
        );
        if (!matchesAllTerms(hay, nameQuery)) return false;
      }
      return true;
    })
    .map((r) => ({
      id: r.id as string,
      date: String(r.date ?? "").slice(0, 10),
      amount: round2(Math.abs(Number(r.amount) || 0)),
      description: (r.description as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      origen_cuenta: (r.origen_cuenta as string | null) ?? null,
      external_ref: (r.external_ref as string | null) ?? null,
      counterparty: (r.counterparty as string | null) ?? null,
    }));

  return NextResponse.json({
    expected_amount: expectedAmount,
    credit_status: credit.status,
    pending: remaining,
    candidates,
  });
}
