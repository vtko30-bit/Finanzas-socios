import { createAdminClient } from "@/lib/supabase/admin";
import {
  emptyBankPositionRows,
  mergeBankPositionRows,
  rowTotal,
  sumBankPositionRows,
  type BankPositionRow,
} from "@/lib/bank-position-defaults";

export type BankPositionSnapshot = {
  snapshotDate: string | null;
  updatedAt: string | null;
  rows: BankPositionRow[];
  totals: { saldoCtaCte: number; ahorro: number; efectivo: number; total: number };
};

export async function loadLatestBankPosition(
  organizationId: string,
): Promise<BankPositionSnapshot> {
  const supabase = createAdminClient();
  const { data: snapshot, error: snapErr } = await supabase
    .from("bank_position_snapshots")
    .select("id, snapshot_date, updated_at")
    .eq("organization_id", organizationId)
    .order("snapshot_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapErr) throw new Error(snapErr.message);

  if (!snapshot) {
    const rows = emptyBankPositionRows();
    return {
      snapshotDate: null,
      updatedAt: null,
      rows,
      totals: sumBankPositionRows(rows),
    };
  }

  const { data: lines, error: linesErr } = await supabase
    .from("bank_position_lines")
    .select("banco, saldo_cta_cte, ahorro, efectivo, total, sort_order")
    .eq("snapshot_id", snapshot.id)
    .order("sort_order", { ascending: true });

  if (linesErr) throw new Error(linesErr.message);

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

  return {
    snapshotDate: String(snapshot.snapshot_date ?? "").slice(0, 10) || null,
    updatedAt: snapshot.updated_at ?? null,
    rows,
    totals: sumBankPositionRows(rows),
  };
}
