import { NextResponse } from "next/server";
import { round2 } from "@/lib/apply-credit-installment-payment";
import { isReconcilableImportSource } from "@/lib/reconcilable-import-source";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(round2(a) - round2(b)) <= 0.02;
}

/**
 * Lista egresos importados (planilla) sin `credit_id` cuyo monto coincide con el total
 * de la cuota indicada — para elegir qué línea conciliar desde Créditos.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: creditId } = await context.params;
  const { searchParams } = new URL(request.url);
  const installmentNumber = Number(searchParams.get("installment_number"));

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

  if (!Number.isFinite(installmentNumber) || installmentNumber < 1) {
    return NextResponse.json({ error: "installment_number inválido" }, { status: 400 });
  }

  const { data: inst, error: iErr } = await supabase
    .from("credit_installments")
    .select("id, installment_number, total_amount, status")
    .eq("credit_id", creditId)
    .eq("organization_id", orgId)
    .eq("installment_number", installmentNumber)
    .maybeSingle();

  if (iErr) {
    return NextResponse.json({ error: iErr.message }, { status: 500 });
  }
  if (!inst) {
    return NextResponse.json({ error: "Cuota no encontrada" }, { status: 404 });
  }

  const totalCuota = round2(Number(inst.total_amount) || 0);

  if (inst.status === "paid") {
    return NextResponse.json({
      installment_total: totalCuota,
      installment_status: "paid",
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

  const band = 2;
  const { data: rows, error: qErr } = await supabase
    .from("transactions")
    .select(
      "id, date, amount, description, source, origen_cuenta, external_ref, type, flow_kind",
    )
    .eq("organization_id", orgId)
    .eq("flow_kind", "operativo")
    .in("type", EXPENSE_TYPES)
    .is("credit_id", null)
    .gte("amount", totalCuota - band)
    .lte("amount", totalCuota + band)
    .order("date", { ascending: false })
    .limit(150);

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const candidates = (rows ?? [])
    .filter((r) => {
      const src = r.source as string | null;
      if (!isReconcilableImportSource(src)) return false;
      const amt = round2(Math.abs(Number(r.amount) || 0));
      return amountsMatch(amt, totalCuota);
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
    installment_total: totalCuota,
    installment_status: inst.status,
    candidates,
  });
}
