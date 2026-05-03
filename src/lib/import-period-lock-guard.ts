import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectBlockedImportDates, fetchImportPeriodLocks } from "@/lib/import-period-lock";

/**
 * Si alguna fecha cae en un período cerrado para importación, devuelve 423.
 * Solo aplica a filas que realmente se intentarían insertar (fechas nuevas).
 */
export async function rejectIfImportDatesLocked(
  supabase: SupabaseClient,
  organizationId: string,
  dates: string[],
): Promise<NextResponse | null> {
  if (!dates.length) return null;
  let locks;
  try {
    locks = await fetchImportPeriodLocks(supabase, organizationId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al cargar períodos cerrados";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const blocked = collectBlockedImportDates(dates, locks);
  if (!blocked.length) return null;
  const sample = blocked.slice(0, 20).join(", ");
  const more = blocked.length > 20 ? ` (+${blocked.length - 20} más)` : "";
  return NextResponse.json(
    {
      error: `Período cerrado para importación: las siguientes fechas están bloqueadas: ${sample}${more}. Quita esas filas del Excel o reabre el período en «Períodos cerrados».`,
      periodLocked: true,
      blockedDates: blocked,
    },
    { status: 423 },
  );
}
