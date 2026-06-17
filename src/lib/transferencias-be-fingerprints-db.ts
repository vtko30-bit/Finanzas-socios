import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildTransferenciasFingerprints,
  fingerprintTransferenciasDuplicado,
  fingerprintTransferenciasFechaMonto,
  type TransferenciasExistingByFamilia,
} from "@/lib/gastos-dedupe-servicios";
import {
  esOrigenTransferencias,
  origenFamiliaBanco,
  type OrigenFamiliaBanco,
} from "@/lib/origen-familia-banco";

const PAGE_SIZE = 1000;

/** Huellas de Transferencias ya guardadas por banco (para omitir cartola duplicada al importar). */
export async function fetchTransferenciasFingerprintsForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<TransferenciasExistingByFamilia> {
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
      .select("date, amount, external_ref, counterparty, origen_cuenta, source")
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

  const byFamilia: Record<OrigenFamiliaBanco, typeof rows> = {
    be: [],
    bci: [],
    bdch: [],
  };

  for (const r of rows) {
    const origen = String(r.origen_cuenta ?? "");
    if (!esOrigenTransferencias(origen)) continue;
    const familia = origenFamiliaBanco(origen);
    if (!familia) continue;
    byFamilia[familia].push({ ...r, source: "excel_egresos" });
  }

  return {
    be: buildTransferenciasFingerprints(byFamilia.be, "be"),
    bci: buildTransferenciasFingerprints(byFamilia.bci, "bci"),
    bdch: buildTransferenciasFingerprints(byFamilia.bdch, "bdch"),
  };
}

/** @deprecated Usar `fetchTransferenciasFingerprintsForOrg`. */
export async function fetchTransferenciasBeFingerprintsForOrg(
  supabase: SupabaseClient,
  organizationId: string,
) {
  const all = await fetchTransferenciasFingerprintsForOrg(supabase, organizationId);
  return all.be ?? buildTransferenciasFingerprints([], "be");
}

/** Huellas de Transferencias ya en BD (evita reimportar el mismo pago con otro Id). */
export async function fetchTransferenciasDuplicateKeysForOrg(
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
      .ilike("origen_cuenta", "%transferencias%")
      .in("type", ["expense", "gasto", "egreso"])
      .range(from, to);

    if (error) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const keys = new Set<string>();
  for (const r of rows) {
    const row = { ...r, source: "excel_egresos" as const };
    const loose = fingerprintTransferenciasFechaMonto(row);
    const strict = fingerprintTransferenciasDuplicado(row);
    if (loose) keys.add(loose);
    if (strict) keys.add(strict);
  }
  return keys;
}
