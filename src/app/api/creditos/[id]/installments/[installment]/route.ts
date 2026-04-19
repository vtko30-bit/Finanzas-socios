import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";

/**
 * Corrección operativa: revierte una cuota pagada a "pending".
 * Elimina solo asientos generados automáticamente por el módulo créditos (`source=creditos`)
 * ligados a la cuota, para que no queden pagos duplicados.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; installment: string }> },
) {
  const { id: creditId, installment } = await context.params;
  const installmentNumber = Number(installment);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getUserOrganization(supabase, user.id);
  const denied = denyIfNotOwner(member);
  if (denied) return denied;
  const orgId = member!.organization_id;

  if (!Number.isFinite(installmentNumber) || installmentNumber < 1) {
    return NextResponse.json({ error: "installment inválida" }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const statusRaw =
    typeof body.status === "string" && body.status.trim()
      ? body.status.trim().toLowerCase()
      : "";
  if (statusRaw !== "pending") {
    return NextResponse.json(
      {
        error:
          "Actualmente solo se permite corregir una cuota pagada a estado pending.",
      },
      { status: 400 },
    );
  }

  const { data: credit, error: cErr } = await supabase
    .from("credits")
    .select("id, status")
    .eq("id", creditId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!credit) return NextResponse.json({ error: "Crédito no encontrado" }, { status: 404 });

  const { data: inst, error: iErr } = await supabase
    .from("credit_installments")
    .select("id, installment_number, status, paid_amount, paid_at")
    .eq("credit_id", creditId)
    .eq("organization_id", orgId)
    .eq("installment_number", installmentNumber)
    .maybeSingle();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  if (!inst) return NextResponse.json({ error: "Cuota no encontrada" }, { status: 404 });

  if (inst.status !== "paid") {
    return NextResponse.json(
      { error: "La cuota no está pagada; no requiere corrección." },
      { status: 409 },
    );
  }

  const { data: deletedRows, error: txDelErr } = await supabase
    .from("transactions")
    .delete()
    .eq("organization_id", orgId)
    .eq("credit_id", creditId)
    .eq("source", "creditos")
    .eq("source_id", String(inst.id))
    .in("credit_component", ["pago_capital", "pago_interes", "comision"])
    .select("id");
  if (txDelErr) return NextResponse.json({ error: txDelErr.message }, { status: 500 });

  const { error: upInstErr } = await supabase
    .from("credit_installments")
    .update({
      status: "pending",
      paid_amount: 0,
      paid_at: null,
    })
    .eq("id", inst.id)
    .eq("organization_id", orgId);
  if (upInstErr) return NextResponse.json({ error: upInstErr.message }, { status: 500 });

  if (credit.status !== "active") {
    await supabase
      .from("credits")
      .update({ status: "active" })
      .eq("id", creditId)
      .eq("organization_id", orgId);
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "credit_installment_revert_to_pending",
    entity_type: "credit",
    entity_id: creditId,
    changes_json: {
      installment_id: inst.id,
      installment_number: installmentNumber,
      prev_status: inst.status,
      prev_paid_amount: inst.paid_amount,
      prev_paid_at: inst.paid_at,
      deleted_transaction_ids: (deletedRows ?? []).map((r) => r.id),
    },
  });

  return NextResponse.json({
    ok: true,
    installment_id: inst.id,
    installment_number: installmentNumber,
    removed_transactions: (deletedRows ?? []).length,
  });
}

