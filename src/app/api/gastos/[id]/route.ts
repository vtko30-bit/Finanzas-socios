import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { logAudit } from "@/lib/audit";
import { patchTransactionConcepto } from "@/lib/patch-transaction-concepto";

type PatchBody = {
  concepto?: unknown;
  concept_id?: unknown;
  description?: unknown;
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

  const hasConcepto = Object.prototype.hasOwnProperty.call(body, "concepto");
  const hasConceptId = Object.prototype.hasOwnProperty.call(body, "concept_id");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");

  if (!hasConcepto && !hasConceptId && !hasDescription) {
    return NextResponse.json(
      { error: "Indica categoría y/o descripción para actualizar" },
      { status: 400 },
    );
  }

  let conceptoOut: string | undefined;
  let conceptIdOut: string | null | undefined;
  let prevConcepto: string | undefined;
  let prevConceptId: string | null | undefined;

  if (hasConcepto || hasConceptId) {
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
    conceptoOut = result.concepto;
    conceptIdOut = result.concept_id;
    prevConcepto = result.prevConcepto;
    prevConceptId = result.prevConceptId;
  }

  let descriptionOut: string | undefined;
  let prevDescription: string | undefined;

  if (hasDescription) {
    const nextDescription =
      typeof body.description === "string" ? body.description.trim() : "";

    const { data: tx, error: fetchError } = await supabase
      .from("transactions")
      .select("id, organization_id, type, description")
      .eq("id", id)
      .maybeSingle();

    if (fetchError || !tx) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }
    if (tx.organization_id !== orgId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    if (String(tx.type ?? "").toLowerCase() !== "expense") {
      return NextResponse.json(
        { error: "Solo se edita la descripción en gastos" },
        { status: 400 },
      );
    }

    prevDescription = String(tx.description ?? "");
    const { error: upErr } = await supabase
      .from("transactions")
      .update({
        description: nextDescription,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", orgId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    descriptionOut = nextDescription;
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: "update_gasto",
    entity_type: "transaction",
    entity_id: id,
    changes_json: {
      antes: {
        ...(prevConcepto !== undefined
          ? { concepto: prevConcepto, concept_id: prevConceptId }
          : {}),
        ...(prevDescription !== undefined ? { description: prevDescription } : {}),
      },
      despues: {
        ...(conceptoOut !== undefined
          ? { concepto: conceptoOut, concept_id: conceptIdOut }
          : {}),
        ...(descriptionOut !== undefined ? { description: descriptionOut } : {}),
      },
    },
  });

  return NextResponse.json({
    ok: true,
    ...(conceptoOut !== undefined
      ? { concepto: conceptoOut, concept_id: conceptIdOut }
      : {}),
    ...(descriptionOut !== undefined ? { description: descriptionOut } : {}),
  });
}
