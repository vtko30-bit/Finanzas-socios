import type { SupabaseClient } from "@supabase/supabase-js";
import {
  destinatarioMpCompatible,
  esDestinatarioEnmascaradoMp,
  esOrigenRetirosMercadoPago,
  fingerprintRetirosMercadoPagoMovimiento,
  fingerprintRetirosMercadoPagoMovimientoLaxo,
  fingerprintRetirosMercadoPagoPorOperacion,
} from "@/lib/gastos-dedupe-servicios";

const PAGE_SIZE = 1000;

export type RetirosMpDuplicateIndex = {
  keys: Set<string>;
  /** fecha|monto|op → destinatarios ya cargados */
  byOperacion: Map<string, string[]>;
};

/** Huellas de retiros MP ya en BD (evita reimportar el mismo pago con otro Id u origen Sin origen). */
export async function fetchRetirosMercadoPagoDuplicateIndexForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<RetirosMpDuplicateIndex> {
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
      // Incluye origen canónico «Mercado Pago» y etiquetas viejas «Retiros…».
      .or(
        "origen_cuenta.ilike.%retiros%,origen_cuenta.ilike.%mercado pago%,origen_cuenta.ilike.%mercadopago%,origen_cuenta.eq.Mercado Pago",
      )
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const keys = new Set<string>();
  const byOperacion = new Map<string, string[]>();
  for (const r of rows) {
    if (!esOrigenRetirosMercadoPago(String(r.origen_cuenta ?? ""))) {
      // filas viejas «Retiros…» ya entran por el or; canónico Mercado Pago también
    }
    const fp = fingerprintRetirosMercadoPagoMovimiento(r);
    const fpLoose = fingerprintRetirosMercadoPagoMovimientoLaxo(r);
    if (fp) keys.add(fp);
    if (fpLoose) keys.add(fpLoose);
    const opKey = fingerprintRetirosMercadoPagoPorOperacion(r);
    if (opKey) {
      const list = byOperacion.get(opKey) ?? [];
      list.push(String(r.counterparty ?? ""));
      byOperacion.set(opKey, list);
    }
  }
  return { keys, byOperacion };
}

/** @deprecated Prefer fetchRetirosMercadoPagoDuplicateIndexForOrg */
export async function fetchRetirosMercadoPagoDuplicateKeysForOrg(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Set<string>> {
  const idx = await fetchRetirosMercadoPagoDuplicateIndexForOrg(
    supabase,
    organizationId,
  );
  return idx.keys;
}

/** True si el movimiento MP nuevo ya está en BD (incl. nombre completo vs enmascarado). */
export function esRetiroMercadoPagoYaCargado(
  row: {
    date?: unknown;
    amount?: unknown;
    external_ref?: unknown;
    counterparty?: unknown;
  },
  index: RetirosMpDuplicateIndex,
): boolean {
  const fp = fingerprintRetirosMercadoPagoMovimiento(row);
  const fpLoose = fingerprintRetirosMercadoPagoMovimientoLaxo(row);
  if ((fp && index.keys.has(fp)) || (fpLoose && index.keys.has(fpLoose))) {
    return true;
  }
  const opKey = fingerprintRetirosMercadoPagoPorOperacion(row);
  if (!opKey) return false;
  const existentes = index.byOperacion.get(opKey);
  if (!existentes?.length) return false;
  const nuevo = String(row.counterparty ?? "");
  // Solo cruzar por N° op. si hay compatibilidad de destinatario (evita borrar Dervis≠Filomena).
  return existentes.some((prev) => {
    if (destinatarioMpCompatible(prev, nuevo)) return true;
    // Reimport enmascarado del mismo pago ya tipificado con nombre completo.
    if (esDestinatarioEnmascaradoMp(nuevo) && !esDestinatarioEnmascaradoMp(prev)) {
      return destinatarioMpCompatible(prev, nuevo);
    }
    if (esDestinatarioEnmascaradoMp(prev) && !esDestinatarioEnmascaradoMp(nuevo)) {
      return destinatarioMpCompatible(prev, nuevo);
    }
    return false;
  });
}
