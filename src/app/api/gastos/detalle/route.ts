import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

const EXPENSE_TYPES = ["expense", "gasto", "egreso"];
const PAGE_SIZE = 1000;

function necesitaConcepto(raw: string) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return true;
  if (t === "pendiente de definir" || t === "por clasificar") return true;
  return false;
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

  // `*` evita error si la migración 0007 aún no está aplicada (columna source_id).
  // Supabase puede limitar resultados por defecto; paginamos para obtener todo el historial.
  const data: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data: page, error } = await supabase
      .from("transactions")
      .select(
        `
        *,
        concept_catalog (
          id,
          label,
          concept_families ( name )
        )
      `,
      )
      .eq("organization_id", member.organization_id)
      .in("type", EXPENSE_TYPES)
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (page ?? []) as Record<string, unknown>[];
    data.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const uniqueById = new Map<string, Record<string, unknown>>();
  for (const raw of data ?? []) {
    const tx = raw as { id?: string };
    if (!tx.id) continue;
    if (!uniqueById.has(tx.id)) uniqueById.set(tx.id, raw);
  }

  const rows = Array.from(uniqueById.values()).map((row) => {
    const origenCuenta =
      (row as { origen_cuenta?: string }).origen_cuenta ?? "";
    const conceptoCol = (row as { concepto?: string }).concepto ?? "";
    const conceptId = (row as { concept_id?: string | null }).concept_id ?? null;
    const cat = row as {
      concept_catalog?: {
        id?: string;
        label?: string;
        concept_families?: { name?: string } | null;
      } | null;
    };
    const familia =
      cat.concept_catalog?.concept_families?.name?.trim() || null;
    const labelCatalogo = cat.concept_catalog?.label?.trim() || "";
    const conceptoEfectivo = labelCatalogo || conceptoCol;
    const idOrigen = String(
      (row as { source_id?: string }).source_id ?? "",
    ).trim();
    return {
      fecha: row.date,
      origen: origenCuenta || row.source || "",
      id: row.id,
      idOrigen,
      nroOperacion: row.external_ref || "",
      nombreDestino: row.counterparty || "",
      descripcion: row.description || "",
      monto: Number(row.amount) || 0,
      concepto: conceptoCol,
      concept_id: conceptId,
      familia,
      necesitaConcepto: necesitaConcepto(conceptoEfectivo),
    };
  });

  return NextResponse.json({ rows });
}
