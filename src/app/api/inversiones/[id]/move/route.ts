import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { dedupeHashManual } from "@/lib/credit-dedupe";
import { isoDateOk, round2 } from "@/lib/inversiones";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { getUserOrganization } from "@/lib/organization";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };
type MoveKind = "aporte" | "rescate" | "rendimiento";

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
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

  let body: {
    kind?: unknown;
    amount?: unknown;
    date?: unknown;
    origen_cuenta?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind.trim().toLowerCase() : "";
  if (kind !== "aporte" && kind !== "rescate" && kind !== "rendimiento") {
    return NextResponse.json({ error: "kind inválido" }, { status: 400 });
  }
  const moveKind = kind as MoveKind;
  const amount = round2(Number(body.amount));
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const origenCuenta =
    typeof body.origen_cuenta === "string" ? body.origen_cuenta.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!isoDateOk(date)) {
    return NextResponse.json({ error: "Fecha inválida (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Monto debe ser > 0" }, { status: 400 });
  }

  const { data: inv, error: invErr } = await supabase
    .from("investments")
    .select(
      "id, name, kind, currency, contributed_total, redeemed_total, yield_total, status",
    )
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "Inversión no encontrada" }, { status: 404 });
  if (inv.status === "closed" && moveKind === "aporte") {
    return NextResponse.json(
      { error: "La inversión está cerrada. Reábrela para registrar un aporte." },
      { status: 422 },
    );
  }

  const contributed = Number(inv.contributed_total) || 0;
  const redeemed = Number(inv.redeemed_total) || 0;
  const investedNet = round2(Math.max(0, contributed - redeemed));
  if (moveKind === "rescate" && amount > investedNet + 0.02) {
    return NextResponse.json(
      {
        error: `El rescate (${amount}) supera el capital invertido (${investedNet}). Si hay ganancia, regístrala como rendimiento.`,
      },
      { status: 422 },
    );
  }

  const labels: Record<MoveKind, string> = {
    aporte: "Aporte a inversión",
    rescate: "Rescate de inversión",
    rendimiento: "Rendimiento de inversión",
  };
  const txType = moveKind === "aporte" ? "expense" : "income";
  const description = `${labels[moveKind]} — ${inv.name}${note ? ` — ${note}` : ""}`;
  const dedupe = dedupeHashManual([
    "investment_move",
    orgId,
    id,
    moveKind,
    date,
    String(amount),
    note,
    String(Date.now()),
  ]);

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      organization_id: orgId,
      date,
      type: txType,
      amount,
      currency: inv.currency || "CLP",
      description,
      counterparty: inv.name,
      payment_method: "",
      external_ref: "",
      origen_cuenta: origenCuenta,
      concepto: labels[moveKind],
      source: "inversiones",
      source_id: id,
      dedupe_hash: dedupe,
      flow_kind: "inversion",
      investment_id: id,
      investment_component: moveKind,
    })
    .select("id")
    .single();

  if (txErr || !tx) {
    return NextResponse.json(
      { error: txErr?.message ?? "No se pudo registrar el movimiento" },
      { status: 500 },
    );
  }

  const patch =
    moveKind === "aporte"
      ? { contributed_total: round2(contributed + amount) }
      : moveKind === "rescate"
        ? { redeemed_total: round2(redeemed + amount) }
        : { yield_total: round2((Number(inv.yield_total) || 0) + amount) };

  const afterRedeemed =
    moveKind === "rescate" ? round2(redeemed + amount) : redeemed;
  const afterContributed =
    moveKind === "aporte" ? round2(contributed + amount) : contributed;
  const remaining = round2(Math.max(0, afterContributed - afterRedeemed));

  const { error: upErr } = await supabase
    .from("investments")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", orgId);
  if (upErr) {
    await supabase.from("transactions").delete().eq("id", tx.id);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await logAudit(supabase, {
    organization_id: orgId,
    actor_user_id: user.id,
    action: `investment_${moveKind}`,
    entity_type: "investment",
    entity_id: id,
    changes_json: { amount, date, transaction_id: tx.id },
  });

  return NextResponse.json({
    ok: true,
    transaction_id: tx.id,
    invested_net: remaining,
    status: inv.status,
  });
}
