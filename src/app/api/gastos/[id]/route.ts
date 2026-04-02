import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { patchTransactionConcepto } from "@/lib/patch-transaction-concepto";

type PatchBody = {
  concepto?: unknown;
  concept_id?: unknown;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const result = await patchTransactionConcepto(supabase, {
    txId: id,
    organizationId: orgId,
    body,
    allowedTypes: ["expense"],
    wrongTypeMessage: "Solo se edita la categoría en gastos",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "update_concepto_gasto",
    entity_type: "transaction",
    entity_id: id,
    changes_json: {
      antes: {
        concepto: result.prevConcepto,
        concept_id: result.prevConceptId,
      },
      despues: { concepto: result.concepto, concept_id: result.concept_id },
    },
  });

  return NextResponse.json({
    ok: true,
    concepto: result.concepto,
    concept_id: result.concept_id,
  });
}
