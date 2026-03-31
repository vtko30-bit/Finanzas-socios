import type { PostgrestError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { logAudit } from "@/lib/audit";

const PAGE = 1000;

type Kind = "ingresos" | "todo";

async function fetchAllRows(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{
    data: Record<string, unknown>[] | null;
    error: PostgrestError | null;
  }>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/**
 * Exporta JSON de respaldo antes de un borrado masivo.
 * `kind=ingresos`: todos los ingresos + lotes excel_ventas (alcance del reset de ventas).
 * `kind=todo`: todos los movimientos + todos los lotes (alcance de reset-todo).
 */
export async function GET(request: Request) {
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
  if (member.role !== "owner") {
    return NextResponse.json(
      { error: "Solo el owner puede generar respaldos pre-borrado." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as Kind | null;
  if (kind !== "ingresos" && kind !== "todo") {
    return NextResponse.json(
      { error: 'Parámetro kind requerido: "ingresos" o "todo"' },
      { status: 400 },
    );
  }

  const orgId = member.organization_id;
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("created_by")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 500 });
  }
  if (!org || org.created_by !== user.id) {
    return NextResponse.json(
      { error: "Solo el usuario creador de la organización puede generar respaldos pre-borrado." },
      { status: 403 },
    );
  }

  try {
    let transactions: Record<string, unknown>[];
    let importBatches: Record<string, unknown>[];

    if (kind === "ingresos") {
      transactions = await fetchAllRows(async (from, to) =>
        supabase
          .from("transactions")
          .select("*")
          .eq("organization_id", orgId)
          .eq("type", "income")
          .order("id", { ascending: true })
          .range(from, to),
      );
      importBatches = await fetchAllRows(async (from, to) =>
        supabase
          .from("import_batches")
          .select("*")
          .eq("organization_id", orgId)
          .eq("summary_json->>importKind", "excel_ventas")
          .order("created_at", { ascending: false })
          .range(from, to),
      );
    } else {
      transactions = await fetchAllRows(async (from, to) =>
        supabase
          .from("transactions")
          .select("*")
          .eq("organization_id", orgId)
          .order("id", { ascending: true })
          .range(from, to),
      );
      importBatches = await fetchAllRows(async (from, to) =>
        supabase
          .from("import_batches")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .range(from, to),
      );
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const payload = {
      version: 1,
      kind,
      exportedAt: new Date().toISOString(),
      organizationId: orgId,
      note:
        kind === "ingresos"
          ? "Incluye todos los movimientos tipo ingreso y lotes importKind excel_ventas (mismo alcance que «Borrar todos los ingresos»)."
          : "Incluye todos los movimientos y lotes de importación (mismo alcance que «Borrar todos los movimientos»).",
      counts: {
        transactions: transactions.length,
        importBatches: importBatches.length,
      },
      transactions,
      importBatches,
    };

    const body = JSON.stringify(payload, null, 2);
    const filename = `respaldo-${kind}-${stamp}.json`;

    await logAudit(supabase, {
      organization_id: orgId,
      actor_user_id: user.id,
      action: "respaldo_pre_borrado",
      entity_type: "export",
      entity_id: kind,
      changes_json: {
        filename,
        transactions: transactions.length,
        importBatches: importBatches.length,
      },
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al generar respaldo";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
