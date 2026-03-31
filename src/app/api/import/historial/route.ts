import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

type SummaryJson = {
  importKind?: string;
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
  fileName?: string;
  fileSize?: number;
};

type RpcRow = {
  import_batch_id: string;
  income_count: number;
  expense_count: number;
};

/** Listado de lotes de importación Excel (ventas, otros ingresos, gastos) con conteos en BD. */
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

  const { data: batchesRaw, error: batchesError } = await supabase
    .from("import_batches")
    .select("id, filename, status, summary_json, created_at")
    .eq("organization_id", member.organization_id)
    .order("created_at", { ascending: false })
    .limit(300);

  if (batchesError) {
    return NextResponse.json({ error: batchesError.message }, { status: 500 });
  }

  const batches = (batchesRaw ?? []).filter((b) => {
    const k = (b.summary_json as SummaryJson | null)?.importKind;
    return (
      k === "excel_ventas" ||
      k === "excel_egresos" ||
      k === "excel_otros_ingresos"
    );
  });

  const { data: countsRaw, error: rpcError } = await supabase.rpc(
    "import_batch_transaction_counts",
    { p_org_id: member.organization_id },
  );

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const countMap = new Map<string, { income: number; expense: number }>();
  for (const row of (countsRaw ?? []) as RpcRow[]) {
    countMap.set(row.import_batch_id, {
      income: Number(row.income_count ?? 0),
      expense: Number(row.expense_count ?? 0),
    });
  }

  let totalVentasIngresos = 0;
  let totalOtrosIngresos = 0;
  let totalGastosEgresos = 0;

  const items = (batches ?? []).map((b) => {
    const summary = (b.summary_json ?? {}) as SummaryJson;
    const kind = summary.importKind ?? "";
    const c = countMap.get(b.id) ?? { income: 0, expense: 0 };

    if (kind === "excel_ventas") {
      totalVentasIngresos += c.income;
    } else if (kind === "excel_otros_ingresos") {
      totalOtrosIngresos += c.income;
    } else if (kind === "excel_egresos") {
      totalGastosEgresos += c.expense;
    }

    return {
      id: b.id,
      filename: b.filename,
      status: b.status,
      createdAt: b.created_at,
      importKind: kind,
      totalRows: summary.totalRows ?? null,
      validRows: summary.validRows ?? null,
      invalidRows: summary.invalidRows ?? null,
      fileSize: summary.fileSize ?? null,
      transactionIncome: c.income,
      transactionExpense: c.expense,
    };
  });

  return NextResponse.json({
    items,
    totals: {
      ventasIngresos: totalVentasIngresos,
      otrosIngresos: totalOtrosIngresos,
      gastosEgresos: totalGastosEgresos,
    },
  });
}
