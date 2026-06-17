import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildTransferenciasBeFingerprints,
  type TransferenciasBeFingerprints,
} from "@/lib/gastos-dedupe-servicios";

const PAGE_SIZE = 1000;

/** Huellas de Transferencias Banco Estado ya guardadas (para omitir TEF al importar). */
export async function fetchTransferenciasBeFingerprintsForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<TransferenciasBeFingerprints> {
  const rows: {
    date?: string;
    amount?: number;
    external_ref?: string | null;
    origen_cuenta?: string | null;
    source?: string | null;
  }[] = [];

  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("transactions")
      .select("date, amount, external_ref, origen_cuenta, source")
      .eq("organization_id", organizationId)
      .eq("source", "excel_egresos")
      .ilike("origen_cuenta", "%transferencias%")
      .in("type", ["expense", "gasto", "egreso"])
      .range(from, to);

    if (error) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const filtered = rows.filter((r) => {
    const o = String(r.origen_cuenta ?? "").toLowerCase();
    if (o.includes("bci") || o.includes("chile")) return false;
    return o.includes("banco") || o.includes("bestado") || o.includes("estado");
  });

  return buildTransferenciasBeFingerprints(
    filtered.map((r) => ({
      ...r,
      source: "excel_egresos",
    })),
  );
}
