import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";
import { denyIfNotOwner } from "@/lib/org-permissions";
import { supabaseErrorMessage } from "@/lib/supabase-error-message";
import {
  emptyBankPositionRows,
  mergeBankPositionRows,
  sumBankPositionRows,
  rowTotal,
  DEFAULT_BANK_POSITION_LABELS,
  type BankPositionRow,
} from "@/lib/bank-position-defaults";

type LineInput = {
  banco?: unknown;
  saldoCtaCte?: unknown;
  ahorro?: unknown;
  efectivo?: unknown;
};

function dbErrorMessage(err: { message?: string; code?: string } | null): string {
  const msg = supabaseErrorMessage(err as Parameters<typeof supabaseErrorMessage>[0]);
  if (
    err?.code === "42P01" ||
    /bank_position/i.test(msg) ||
    /schema cache/i.test(msg)
  ) {
    return `${msg}. Ejecuta las migraciones 0037 y 0038 en Supabase.`;
  }
  return msg;
}

function parseAmount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function buildResponse(
  snapshotDate: string | null,
  updatedAt: string | null,
  rows: BankPositionRow[],
) {
  return {
    snapshotDate,
    updatedAt,
    rows,
    totals: sumBankPositionRows(rows),
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

  const { data: snapshot, error: snapErr } = await supabase
    .from("bank_position_snapshots")
    .select("id, snapshot_date, updated_at")
    .eq("organization_id", member.organization_id)
    .order("snapshot_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapErr) {
    return NextResponse.json({ error: dbErrorMessage(snapErr) }, { status: 500 });
  }

  if (!snapshot) {
    return NextResponse.json(buildResponse(null, null, emptyBankPositionRows()));
  }

  const { data: lines, error: linesErr } = await supabase
    .from("bank_position_lines")
    .select("banco, saldo_cta_cte, ahorro, efectivo, total, sort_order")
    .eq("snapshot_id", snapshot.id)
    .order("sort_order", { ascending: true });

  if (linesErr) {
    return NextResponse.json({ error: dbErrorMessage(linesErr) }, { status: 500 });
  }

  const rows = mergeBankPositionRows(
    (lines ?? []).map((l) => {
      const saldoCtaCte = Number(l.saldo_cta_cte) || 0;
      const ahorro = Number(l.ahorro) || 0;
      const efectivo = Number(l.efectivo) || 0;
      return {
        banco: String(l.banco ?? ""),
        saldoCtaCte,
        ahorro,
        efectivo,
        total: Number(l.total) || rowTotal(saldoCtaCte, ahorro, efectivo),
      };
    }),
  );

  return NextResponse.json(
    buildResponse(
      String(snapshot.snapshot_date ?? "").slice(0, 10),
      snapshot.updated_at ?? null,
      rows,
    ),
  );
}

export async function POST(request: Request) {
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

  let body: { snapshotDate?: unknown; lines?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const snapshotDate = String(body.snapshotDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }

  const rawLines = Array.isArray(body.lines) ? (body.lines as LineInput[]) : [];
  const allowed = new Set<string>(DEFAULT_BANK_POSITION_LABELS);
  const rows: BankPositionRow[] = [];

  for (const label of DEFAULT_BANK_POSITION_LABELS) {
    const input = rawLines.find((l) => String(l.banco ?? "").trim() === label);
    const saldoCtaCte = parseAmount(input?.saldoCtaCte);
    const ahorro = parseAmount(input?.ahorro);
    const efectivo = parseAmount(input?.efectivo);
    rows.push({
      banco: label,
      saldoCtaCte,
      ahorro,
      efectivo,
      total: rowTotal(saldoCtaCte, ahorro, efectivo),
    });
  }

  for (const line of rawLines) {
    const banco = String(line.banco ?? "").trim();
    if (banco && !allowed.has(banco)) {
      return NextResponse.json(
        { error: `Banco no reconocido: ${banco}` },
        { status: 400 },
      );
    }
  }

  const now = new Date().toISOString();

  const { data: existing, error: findErr } = await supabase
    .from("bank_position_snapshots")
    .select("id")
    .eq("organization_id", orgId)
    .eq("snapshot_date", snapshotDate)
    .maybeSingle();

  if (findErr) {
    return NextResponse.json({ error: dbErrorMessage(findErr) }, { status: 500 });
  }

  let snapshotId = existing?.id as string | undefined;

  if (snapshotId) {
    const { error: updErr } = await supabase
      .from("bank_position_snapshots")
      .update({ updated_at: now, created_by: user.id })
      .eq("id", snapshotId);

    if (updErr) {
      return NextResponse.json({ error: dbErrorMessage(updErr) }, { status: 500 });
    }

    const { error: delErr } = await supabase
      .from("bank_position_lines")
      .delete()
      .eq("snapshot_id", snapshotId);

    if (delErr) {
      return NextResponse.json({ error: dbErrorMessage(delErr) }, { status: 500 });
    }
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("bank_position_snapshots")
      .insert({
        organization_id: orgId,
        snapshot_date: snapshotDate,
        created_by: user.id,
        updated_at: now,
      })
      .select("id")
      .single();

    if (insErr || !inserted) {
      return NextResponse.json(
        { error: dbErrorMessage(insErr) },
        { status: 500 },
      );
    }
    snapshotId = inserted.id;
  }

  const lineRows = rows.map((r, idx) => ({
    snapshot_id: snapshotId!,
    banco: r.banco,
    saldo_cta_cte: r.saldoCtaCte,
    ahorro: r.ahorro,
    efectivo: r.efectivo,
    total: r.total,
    sort_order: idx,
  }));

  const { error: linesErr } = await supabase
    .from("bank_position_lines")
    .insert(lineRows);

  if (linesErr) {
    return NextResponse.json({ error: dbErrorMessage(linesErr) }, { status: 500 });
  }

  return NextResponse.json(
    buildResponse(snapshotDate, now, rows),
  );
}
