import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fingerprintRetirosMercadoPagoMovimiento,
  fingerprintRetirosMercadoPagoMovimientoLaxo,
} from "@/lib/gastos-dedupe-servicios";

const PAGE_SIZE = 1000;

/** Huellas de retiros MP ya en BD (evita reimportar el mismo pago con otro Id u origen Sin origen). */
export async function fetchRetirosMercadoPagoDuplicateKeysForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Set<string>> {
  const rows: {
    date?: string;
    amount?: number;
    external_ref?: string | null;
    counterparty?: string | null;
    origen_cuenta?: string | null;
    source?: string | null;
  }[] = [];

  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("transactions")
      .select("date, amount, external_ref, counterparty, origen_cuenta, source")
      .eq("organization_id", organizationId)
      .eq("source", "excel_egresos")
      .in("type", ["expense", "gasto", "egreso"])
      .ilike("origen_cuenta", "%retiros%")
      .range(from, to);

    if (error) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const keys = new Set<string>();
  for (const r of rows) {
    const fp = fingerprintRetirosMercadoPagoMovimiento(r);
    const fpLoose = fingerprintRetirosMercadoPagoMovimientoLaxo(r);
    if (fp) keys.add(fp);
    if (fpLoose) keys.add(fpLoose);
  }
  return keys;
}
