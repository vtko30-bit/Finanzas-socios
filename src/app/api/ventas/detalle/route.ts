import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { categoriaMostradaDesdeRawTx } from "@/lib/categoria-excluida";
import { familyIdDesdeRawTx } from "@/lib/familia-excluida";
import {
  fetchExcludedFamilyIdSet,
  rowMatchesExcludedFamily,
} from "@/lib/org-excluded-families-db";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/organization";

const PAGE_SIZE = 1000;

/** Dos letras del nombre de sucursal (solo A–Z) para prefijo de Id corto. */
function prefijoSucursal(s: string): string {
  const t = (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  if (t.length >= 2) return t.slice(0, 2);
  if (t.length === 1) return `${t}0`;
  return "XX";
}

/** Número de 5 dígitos estable por fila (derivado del id de transacción). */
function numeroIdVentaCorto(transactionId: string): string {
  const h = createHash("sha256").update(transactionId).digest("hex");
  const n = (parseInt(h.slice(0, 8), 16) % 90_000) + 10_000;
  return String(n);
}

function idVentaCorto(sucursal: string, transactionId: string): string {
  return `${prefijoSucursal(sucursal)}${numeroIdVentaCorto(transactionId)}`;
}

function necesitaConcepto(raw: string) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return true;
  if (t === "pendiente de definir" || t === "por clasificar") return true;
  return false;
}

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const soloExcluidos = searchParams.get("soloExcluidos") === "1";

  let excludedFamilyIds: Set<string>;
  try {
    excludedFamilyIds = await fetchExcludedFamilyIdSet(
      supabase,
      member.organization_id,
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al cargar exclusiones" },
      { status: 500 },
    );
  }

  const data: Array<Record<string, unknown>> = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data: page, error } = await supabase
      .from("transactions")
      .select(
        `
        id,
        date,
        source,
        origen_cuenta,
        concepto,
        concept_id,
        external_ref,
        payment_method,
        amount,
        concept_catalog (
          id,
          label,
          family_id,
          concept_families ( id, name )
        )
      `,
      )
      .eq("organization_id", member.organization_id)
      // Compatibilidad con filas históricas previas a flow_kind (null).
      .or("flow_kind.eq.operativo,flow_kind.is.null")
      .eq("type", "income")
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const chunk = (page ?? []) as Array<Record<string, unknown>>;
    data.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const rows = data.map((row) => {
    const txId = String((row as { id?: string }).id ?? "");
    const origenCuenta =
      (row as { origen_cuenta?: string }).origen_cuenta ?? "";
    const conceptoCol = (row as { concepto?: string }).concepto ?? "";
    const conceptId = (row as { concept_id?: string | null }).concept_id ?? null;
    const medioPago = (row as { payment_method?: string }).payment_method ?? "";
    const cat = row as {
      concept_catalog?: {
        id?: string;
        label?: string;
        family_id?: string | null;
        concept_families?: { id?: string; name?: string } | null;
      } | null;
    };
    const familia =
      cat.concept_catalog?.concept_families?.name?.trim() || null;
    const labelCatalogo = cat.concept_catalog?.label?.trim() || "";
    const conceptoEfectivo = labelCatalogo || conceptoCol;
    const categoriaMostrada = categoriaMostradaDesdeRawTx({
      concepto: conceptoCol,
      concept_catalog: cat.concept_catalog ?? null,
    });
    const familyId = familyIdDesdeRawTx({
      concept_catalog: cat.concept_catalog ?? null,
    });
    const externalRef = String((row as { external_ref?: string }).external_ref ?? "").trim();
    // No usar `source` como sucursal: ese campo es técnico (p. ej. "excel_ventas").
    const sucursalLabel = String(origenCuenta || "Sin sucursal");
    const fecha = String((row as { date?: string }).date ?? "");
    return {
      id: txId,
      idVenta: idVentaCorto(sucursalLabel, txId),
      externalRef,
      sucursal: sucursalLabel,
      fecha,
      medioPago,
      monto: Number((row as { amount?: unknown }).amount) || 0,
      concepto: conceptoCol,
      concept_id: conceptId,
      familia,
      necesitaConcepto: necesitaConcepto(conceptoEfectivo),
      categoriaMostrada,
      familyId,
    };
  });

  const filtered = rows.filter((r) => {
    const fid = (r as { familyId?: string | null }).familyId ?? null;
    const excl = rowMatchesExcludedFamily(fid, excludedFamilyIds);
    return soloExcluidos ? excl : !excl;
  });

  return NextResponse.json({ rows: filtered });
}
