import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];
const PAGE_SIZE = 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: loanId } = await context.params;
  const { searchParams } = new URL(request.url);
  const nameQuery = normalizeSearchText(String(searchParams.get("name") ?? ""));
  const amountQueryRaw = String(searchParams.get("amount") ?? "").trim();
  const amountQuery =
    amountQueryRaw !== "" && Number.isFinite(Number(amountQueryRaw))
      ? round2(Number(amountQueryRaw))
      : null;
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

  const { data: loan, error: lErr } = await supabase
    .from("loans_given")
    .select("id, principal, disbursement_date")
    .eq("id", loanId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!loan) return NextResponse.json({ error: "Préstamo no encontrado" }, { status: 404 });

  const { data: disbursementTx, error: dErr } = await supabase
    .from("transactions")
    .select("id, credit_component, amount")
    .eq("organization_id", orgId)
    .eq("loan_given_id", loanId)
    .eq("source", "prestamos_otorgados")
    .in("credit_component", ["prestamo_otorgado", "prestamo_otorgado_conciliado"])
    .limit(300);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  const disbursementRows = disbursementTx ?? [];
  if (disbursementRows.length === 0) {
    return NextResponse.json(
      { error: "No se encontró el movimiento de desembolso del préstamo." },
      { status: 409 },
    );
  }

  const principal = round2(Number(loan.principal) || 0);
  const conciliatedAmount = round2(
    disbursementRows
      .filter((r) => String(r.credit_component ?? "") === "prestamo_otorgado_conciliado")
      .reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
  );
  const remainingToReconcile = round2(principal - conciliatedAmount);
  const alreadyReconciled = remainingToReconcile <= 0.02;
  if (alreadyReconciled) {
    return NextResponse.json({
      principal,
      conciliated_amount: conciliatedAmount,
      remaining_to_reconcile: 0,
      disbursement_date: loan.disbursement_date,
      already_reconciled: true,
      candidates: [] as {
        id: string;
        date: string;
        amount: number;
        description: string | null;
        source: string | null;
        origen_cuenta: string | null;
        external_ref: string | null;
      }[],
    });
  }

  const band = 0.02;
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data: page, error: qErr } = await supabase
      .from("transactions")
      .select(
        "id, date, amount, counterparty, description, source, origen_cuenta, external_ref, type, flow_kind",
      )
      .eq("organization_id", orgId)
      .eq("flow_kind", "operativo")
      .in("type", EXPENSE_TYPES)
      .is("loan_given_id", null)
      .is("credit_id", null)
      .gt("amount", 0)
      .lte("amount", remainingToReconcile + band)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
    const chunk = (page ?? []) as Record<string, unknown>[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (nameQuery && rows.length >= 10000) break;
  }

  const candidates = (rows ?? [])
    .filter((r) => {
      const amt = round2(Math.abs(Number(r.amount) || 0));
      if (!(amt > 0 && amt <= remainingToReconcile + 0.02)) return false;
      if (amountQuery != null && Math.abs(amt - amountQuery) > 0.02) return false;
      if (nameQuery) {
        const nombre = normalizeSearchText(String(r.counterparty ?? ""));
        if (!matchesAllTerms(nombre, nameQuery)) return false;
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
    }));

  return NextResponse.json({
    principal,
    conciliated_amount: conciliatedAmount,
    remaining_to_reconcile: remainingToReconcile,
    disbursement_date: loan.disbursement_date,
    already_reconciled: false,
    candidates,
  });
}
