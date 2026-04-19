import type { SupabaseClient } from "@supabase/supabase-js";
import { categoriaMostradaDesdeRawTx } from "@/lib/categoria-excluida";
import { loadConceptosInventario } from "@/lib/conceptos-inventario-data";
import { familiaNombreDesdeRawTx, familyIdDesdeRawTx } from "@/lib/familia-excluida";
import type {
  ResumenPivotMainPayload,
  ResumenPivotPorSucursalPayload,
} from "@/lib/resumen-pivot-core";
import { medioPagoResumenParaExport } from "@/lib/forma-pago";
import {
  fetchExcludedFamilyIdSet,
  rowMatchesExcludedFamily,
} from "@/lib/org-excluded-families-db";

const PAGE_SIZE = 1000;
const EXPENSE_TYPES = ["expense", "gasto", "egreso"] as const;

const FAMILIAS_SOCIOS = new Set(["mario", "mena", "victor"]);

export {
  parseReporteVista,
  REPORTE_VISTAS,
  type ReporteVista,
} from "@/lib/reportes-vistas";

export function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function tipoMovimientoLegible(type: string | null | undefined): string {
  const t = String(type ?? "").trim().toLowerCase();
  if (t === "income") return "Ingreso";
  if (t === "expense" || t === "gasto" || t === "egreso") return "Gasto";
  return type ? String(type) : "";
}

type TxExportRow = {
  id: string;
  date: string;
  type: string;
  amount: number | string;
  currency: string;
  description: string;
  counterparty: string;
  payment_method: string;
  external_ref: string;
  origen_cuenta: string;
  concepto: string;
  concept_id: string | null;
  source: string;
  source_id?: string;
  flow_kind?: string | null;
  credit_id?: string | null;
  credit_component?: string | null;
  loan_given_id?: string | null;
  concept_catalog: {
    label?: string | null;
    family_id?: string | null;
    concept_families?: { id?: string; name?: string | null } | null;
  } | null;
};

export async function fetchTransaccionesParaExporte(args: {
  supabase: SupabaseClient;
  organizationId: string;
  from: string | null;
  to: string | null;
  /** "all" | "income" | "expense" — expense incluye variantes gasto/egreso */
  typeFilter: string | null;
  vista:
    | "movimientos"
    | "ventas"
    | "gastos"
    | "excluidos"
    | "socios";
}): Promise<{ rows: TxExportRow[]; error: string | null }> {
  const rows: TxExportRow[] = [];
  let from = 0;
  const typeFilter = args.typeFilter ?? "all";

  let excludedIds: Set<string> = new Set();
  if (args.vista === "excluidos") {
    try {
      excludedIds = await fetchExcludedFamilyIdSet(
        args.supabase,
        args.organizationId,
      );
    } catch (e) {
      return {
        rows: [],
        error: e instanceof Error ? e.message : "Error exclusiones",
      };
    }
  }

  while (true) {
    const to = from + PAGE_SIZE - 1;
    let q = args.supabase
      .from("transactions")
      .select(
        `
        id,
        date,
        type,
        amount,
        currency,
        description,
        counterparty,
        payment_method,
        external_ref,
        origen_cuenta,
        concepto,
        concept_id,
        source,
        source_id,
        flow_kind,
        credit_id,
        credit_component,
        loan_given_id,
        concept_catalog (
          label,
          family_id,
          concept_families ( id, name )
        )
      `,
      )
      .eq("organization_id", args.organizationId)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (args.from) q = q.gte("date", args.from);
    if (args.to) q = q.lte("date", args.to);

    if (args.vista === "ventas") {
      q = q.eq("type", "income").eq("flow_kind", "operativo");
    } else if (args.vista === "gastos") {
      q = q.in("type", [...EXPENSE_TYPES]).eq("flow_kind", "operativo");
    } else if (typeFilter === "income") {
      q = q.eq("type", "income");
    } else if (typeFilter === "expense") {
      q = q.in("type", [...EXPENSE_TYPES]);
    }

    const { data, error } = await q;
    if (error) return { rows: [], error: error.message };
    const page = (data ?? []) as TxExportRow[];

    for (const row of page) {
      if (args.vista === "excluidos") {
        const fid = familyIdDesdeRawTx({
          concept_catalog: row.concept_catalog ?? null,
        });
        if (!rowMatchesExcludedFamily(fid, excludedIds)) continue;
      }
      if (args.vista === "socios") {
        if (String(row.flow_kind ?? "operativo") !== "operativo") continue;
        const fam = familiaNombreDesdeRawTx(row).trim().toLowerCase();
        if (!FAMILIAS_SOCIOS.has(fam)) continue;
        if (!EXPENSE_TYPES.includes(row.type as (typeof EXPENSE_TYPES)[number])) {
          continue;
        }
      }
      rows.push(row);
    }

    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { rows, error: null };
}

export function filaMovimientoParaCsv(row: TxExportRow): Record<string, string | number> {
  const medioRaw = String(row.payment_method ?? "").trim();
  const medioResumen = medioPagoResumenParaExport({
    type: row.type,
    paymentMethod: row.payment_method,
  });
  return {
    id: row.id,
    fecha: row.date,
    tipo_movimiento: tipoMovimientoLegible(row.type),
    tipo_codigo: row.type,
    monto: Number(row.amount) || 0,
    moneda: row.currency ?? "",
    descripcion: row.description ?? "",
    contraparte: row.counterparty ?? "",
    origen_cuenta: row.origen_cuenta ?? "",
    medio_pago_valor_importado: medioRaw,
    medio_pago_resumen: medioResumen,
    referencia: row.external_ref ?? "",
    concepto_planilla: row.concepto ?? "",
    categoria: categoriaMostradaDesdeRawTx({
      concepto: row.concepto,
      concept_catalog: row.concept_catalog,
    }),
    familia: familiaNombreDesdeRawTx(row),
    fuente: row.source ?? "",
    id_origen: String(row.source_id ?? "").trim(),
    flujo: String(row.flow_kind ?? "operativo"),
    credito_id: String(row.credit_id ?? "").trim(),
    prestamo_otorgado_id: String(row.loan_given_id ?? "").trim(),
    componente_credito: String(row.credit_component ?? "").trim(),
  };
}

export function flattenResumenParaFilas(
  payload: ResumenPivotMainPayload,
): Record<string, string | number>[] {
  const { monthKeys } = payload;
  const out: Record<string, string | number>[] = [];

  for (const r of payload.ventas.rows) {
    const row: Record<string, string | number> = {
      seccion: "Ventas (resumen)",
      etiqueta: r.formaPago,
      total: r.total,
    };
    for (const mk of monthKeys) row[mk] = r.byMonth[mk] ?? 0;
    out.push(row);
  }
  for (const r of payload.gastos.rows) {
    const row: Record<string, string | number> = {
      seccion: "Gastos negocio (resumen)",
      etiqueta: r.familia,
      total: r.total,
    };
    for (const mk of monthKeys) row[mk] = r.byMonth[mk] ?? 0;
    out.push(row);
  }
  for (const r of payload.gastosSocios.rows) {
    const row: Record<string, string | number> = {
      seccion: "Gastos socios (resumen)",
      etiqueta: r.familia,
      total: r.total,
    };
    for (const mk of monthKeys) row[mk] = r.byMonth[mk] ?? 0;
    out.push(row);
  }

  return out;
}

export function headersResumenCsv(monthKeys: string[]): string[] {
  return ["seccion", "etiqueta", ...monthKeys, "total"];
}

export function headersResumenPorSucursalCsv(monthKeys: string[]): string[] {
  return ["sucursal", "seccion", "etiqueta", ...monthKeys, "total"];
}

/** Filas del desglose por `origen_cuenta` (misma lógica que resumen con ventasPorSucursal). */
export function flattenResumenPorSucursalParaFilas(
  payload: ResumenPivotPorSucursalPayload,
): Record<string, string | number>[] {
  const { monthKeys } = payload;
  const out: Record<string, string | number>[] = [];

  for (const bloque of payload.ventasPorSucursalLista) {
    for (const r of bloque.rows) {
      const row: Record<string, string | number> = {
        sucursal: bloque.sucursal,
        seccion: "Ventas (por sucursal)",
        etiqueta: r.formaPago,
        total: r.total,
      };
      for (const mk of monthKeys) row[mk] = r.byMonth[mk] ?? 0;
      out.push(row);
    }
  }
  for (const bloque of payload.gastosPorSucursalLista) {
    for (const r of bloque.rows) {
      const row: Record<string, string | number> = {
        sucursal: bloque.sucursal,
        seccion: "Gastos negocio (por sucursal)",
        etiqueta: r.familia,
        total: r.total,
      };
      for (const mk of monthKeys) row[mk] = r.byMonth[mk] ?? 0;
      out.push(row);
    }
  }
  for (const r of payload.gastosSocios.rows) {
    const row: Record<string, string | number> = {
      sucursal: "",
      seccion: "Gastos socios (sin desglose por sucursal)",
      etiqueta: r.familia,
      total: r.total,
    };
    for (const mk of monthKeys) row[mk] = r.byMonth[mk] ?? 0;
    out.push(row);
  }

  return out;
}

export async function fetchFamiliasParaExporte(args: {
  supabase: SupabaseClient;
  organizationId: string;
}): Promise<{
  rows: Array<{ id: string; nombre: string; orden: number }>;
  error: string | null;
}> {
  const { data, error } = await args.supabase
    .from("concept_families")
    .select("id, name, sort_order")
    .eq("organization_id", args.organizationId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  const rows = (data ?? []).map((f) => ({
    id: String(f.id ?? ""),
    nombre: String(f.name ?? "").trim(),
    orden: Number(f.sort_order) || 0,
  }));
  return { rows, error: null };
}

export const FAMILIAS_CSV_HEADERS = ["id", "nombre", "orden"];

export async function fetchCategoriasInventarioParaExporte(args: {
  supabase: SupabaseClient;
  organizationId: string;
}): Promise<{
  rows: Array<{
    concept_id: string;
    categoria: string;
    familia_id: string;
    familia: string;
    solo_planilla: string;
  }>;
  error: string | null;
}> {
  const { families, conceptos, error } = await loadConceptosInventario({
    supabase: args.supabase,
    organizationId: args.organizationId,
  });
  if (error) return { rows: [], error };

  const famName = new Map<string, string>();
  for (const f of families) {
    famName.set(f.id, String(f.name ?? "").trim());
  }

  const rows = conceptos.map((c) => ({
    concept_id: c.id ?? "",
    categoria: c.label,
    familia_id: c.family_id ?? "",
    familia: c.family_id ? famName.get(c.family_id) || "" : "",
    solo_planilla: c.solo_planilla ? "sí" : "no",
  }));
  return { rows, error: null };
}

export const CATEGORIAS_CSV_HEADERS = [
  "concept_id",
  "categoria",
  "familia_id",
  "familia",
  "solo_planilla",
];

export const MOVIMIENTOS_CSV_HEADERS = [
  "id",
  "fecha",
  "tipo_movimiento",
  "tipo_codigo",
  "monto",
  "moneda",
  "descripcion",
  "contraparte",
  "origen_cuenta",
  "medio_pago_valor_importado",
  "medio_pago_resumen",
  "referencia",
  "concepto_planilla",
  "categoria",
  "familia",
  "fuente",
  "id_origen",
  "flujo",
  "credito_id",
  "prestamo_otorgado_id",
  "componente_credito",
];

