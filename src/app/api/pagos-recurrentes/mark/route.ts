import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import { isReconcilableImportSource } from "@/lib/reconcilable-import-source";
import { currentYearMonthChile } from "@/lib/recurring-obligations";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];

/**
 * Marca una obligación del mes como pagada vinculándola a un egreso importado.
 * No modifica la transacción (no setea credit_id): el egreso sigue en Gastos,
 * a diferencia de la conciliación de cuotas de crédito.
 */
export async function POST(request: Request) {
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

  let body: {
    obligation_id?: string;
    year?: number;
    month?: number;
    paid?: boolean;
    transaction_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const obligationId = String(body.obligation_id ?? "").trim();
  if (!obligationId) {
    return NextResponse.json({ error: "obligation_id requerido" }, { status: 400 });
  }

  const ym = currentYearMonthChile();
  const year = Number(body.year ?? ym.year);
  const month = Number(body.month ?? ym.month);
  const paid = body.paid !== false;
  const transactionId =
    body.transaction_id === null || body.transaction_id === undefined
      ? null
      : String(body.transaction_id).trim() || null;

  const { data: obligation, error: obErr } = await supabase
    .from("recurring_obligations")
    .select("id")
    .eq("id", obligationId)
    .eq("organization_id", member.organization_id)
    .maybeSingle();

  if (obErr) {
    return NextResponse.json({ error: supabaseErrorMessage(obErr) }, { status: 500 });
  }
  if (!obligation) {
    return NextResponse.json({ error: "Obligación no encontrada" }, { status: 404 });
  }

  if (paid) {
    if (!transactionId) {
      return NextResponse.json(
        {
          error:
            "Para marcar como pagado debes asociar un movimiento (egreso importado).",
        },
        { status: 400 },
      );
    }

    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("id, type, flow_kind, source, credit_id, organization_id")
      .eq("id", transactionId)
      .eq("organization_id", member.organization_id)
      .maybeSingle();

    if (txErr) {
      return NextResponse.json({ error: supabaseErrorMessage(txErr) }, { status: 500 });
    }
    if (!tx) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }
    if (String(tx.flow_kind) !== "operativo") {
      return NextResponse.json(
        { error: "El movimiento debe ser operativo" },
        { status: 400 },
      );
    }
    if (!EXPENSE_TYPES.includes(String(tx.type).toLowerCase())) {
      return NextResponse.json(
        { error: "El movimiento debe ser un egreso" },
        { status: 400 },
      );
    }
    if (tx.credit_id) {
      return NextResponse.json(
        { error: "Ese movimiento ya está vinculado a un crédito" },
        { status: 400 },
      );
    }
    if (!isReconcilableImportSource(tx.source as string | null)) {
      return NextResponse.json(
        {
          error:
            "Solo se pueden asociar egresos importados (planilla excel_…), como en créditos.",
        },
        { status: 400 },
      );
    }

    const { data: otherMark } = await supabase
      .from("recurring_obligation_marks")
      .select("id, obligation_id, year, month")
      .eq("organization_id", member.organization_id)
      .eq("transaction_id", transactionId)
      .maybeSingle();

    if (
      otherMark &&
      (otherMark.obligation_id !== obligationId ||
        Number(otherMark.year) !== year ||
        Number(otherMark.month) !== month)
    ) {
      return NextResponse.json(
        { error: "Ese movimiento ya está asociado a otra obligación" },
        { status: 409 },
      );
    }
  }

  const { error } = await supabase.from("recurring_obligation_marks").upsert(
    {
      obligation_id: obligationId,
      organization_id: member.organization_id,
      year,
      month,
      marked_paid: paid,
      marked_by: user.id,
      marked_at: new Date().toISOString(),
      transaction_id: paid ? transactionId : null,
    },
    { onConflict: "obligation_id,year,month" },
  );

  if (error) {
    return NextResponse.json({ error: supabaseErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    year,
    month,
    paid,
    transaction_id: paid ? transactionId : null,
  });
}
