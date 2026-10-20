import { applyFudoRenderedCash } from "@/lib/fudo/rendered-cash";
import { createRgSuiteAdmin } from "@/lib/fudo/rg-suite";
import { getActiveFudoSucursales } from "@/lib/fudo/branches";
import { FudoClient } from "@/lib/fudo/client";
import {
  mapCashMovementsToRows,
  mapExpensesToGastoRows,
  mapSalesToMixDetalleRows,
  mapSalesToVentasRows,
} from "@/lib/fudo/map";

export type FudoSyncParams = {
  organizationId: string;
  fromDate: string;
  toDate: string;
  trigger?: "manual" | "cron";
  /** Si se indica, solo sincroniza esas fuentes (ids env: rg, happy, ramadasrg2026…). */
  branchIds?: string[];
  /**
   * Incluir eventos puntuales (Ramadas, Exponor…).
   * Default: true en sync manual; el cron debe pasar false.
   */
  includeEvents?: boolean;
};

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function inRange(fecha: string, from: string, to: string) {
  return fecha >= from && fecha <= to;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function syncFudoRange(params: FudoSyncParams) {
  const {
    organizationId,
    fromDate,
    toDate,
    trigger = "manual",
    branchIds,
    includeEvents = trigger !== "cron",
  } = params;
  const admin = createRgSuiteAdmin();
  let sucursales = getActiveFudoSucursales(process.env, { includeEvents });
  if (branchIds?.length) {
    const wanted = new Set(branchIds.map((id) => id.trim().toLowerCase()).filter(Boolean));
    // Si piden un evento explícito, incluirlo aunque el cron no sincronice eventos.
    sucursales = getActiveFudoSucursales(process.env, { includeEvents: true }).filter(
      (s) => wanted.has(s.id),
    );
    if (!sucursales.length) {
      throw new Error(
        `Ninguna sucursal/evento activo coincide con: ${[...wanted].join(", ")}`,
      );
    }
  }

  const staleBefore = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  await admin
    .schema("fudo")
    .from("sync_runs")
    .update({
      status: "error",
      error: "Se interrumpió (tiempo agotado).",
      finished_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("status", "running")
    .lt("started_at", staleBefore);

  const { data: run, error: runErr } = await admin
    .schema("fudo")
    .from("sync_runs")
    .insert({
      organization_id: organizationId,
      from_date: fromDate,
      to_date: toDate,
      status: "running",
      trigger,
      stats: {},
    })
    .select("id")
    .single();

  if (runErr || !run) {
    throw new Error(runErr?.message || "No se pudo crear sync_run");
  }

  const stats: Record<string, unknown> = {
    branches: [] as unknown[],
    payments: 0,
    items: 0,
    expenses: 0,
    cashMovements: 0,
  };
  const branchStats: unknown[] = [];
  const errors: string[] = [];

  const salesFrom = `${addDays(fromDate, -1)}T00:00:00Z`;
  const salesTo = `${addDays(toDate, 2)}T00:00:00Z`;
  const expFrom = addDays(fromDate, -1);
  const expTo = addDays(toDate, 1);

  async function syncOneBranch(s: (typeof sucursales)[number]) {
    const client = new FudoClient(s.credentials);
    // Ventas / gastos / caja en paralelo (antes era secuencial).
    const [sales, expensesRes, cashRes] = await Promise.all([
      client.fetchClosedSales(salesFrom, salesTo),
      client.fetchExpenses(expFrom, expTo),
      client.fetchCashMovements(salesFrom, salesTo),
    ]);

    const ventas = mapSalesToVentasRows(s.label, sales).filter((r) =>
      inRange(r.Fecha, fromDate, toDate),
    );
    const mix = mapSalesToMixDetalleRows(s.label, sales).filter((r) =>
      inRange(r.Fecha, fromDate, toDate),
    );
    const gastos = mapExpensesToGastoRows(s.label, expensesRes).filter((r) =>
      inRange(r.Fecha, fromDate, toDate),
    );
    const cashRows = mapCashMovementsToRows(s.label, cashRes).filter((r) =>
      inRange(r.Fecha, fromDate, toDate),
    );

    const paymentRows = ventas.map((v) => ({
      organization_id: organizationId,
      branch_code: s.id,
      branch_label: s.label,
      business_date: v.Fecha,
      fudo_sale_id: String(v.Id).split("-")[0],
      fudo_payment_id: String(v.Id),
      payment_method: v["Medio de Pago"],
      amount: v.Total,
      sale_type: "",
      closed_at: null as string | null,
    }));

    const itemRows = mix.map((m) => ({
      organization_id: organizationId,
      branch_code: s.id,
      branch_label: s.label,
      business_date: m.Fecha,
      fudo_sale_id: m["Id Venta"],
      fudo_item_id: m["Id Ítem"],
      product_name: m.Producto,
      category_name: m.Categoría,
      quantity: m.Cantidad,
      unit_price: m["Precio unitario"],
      line_total: m["Total línea"],
    }));

    const expenseRows = gastos.map((g) => ({
      organization_id: organizationId,
      branch_code: s.id,
      branch_label: s.label,
      business_date: g.Fecha,
      fudo_expense_id: g.Id,
      amount: g["Cheques / Cargos"],
      concept: g.Concepto,
      description: g.Descripción,
      payment_method: g["Medio de Pago"],
      provider_name: g.Proveedor,
      status: "PAID",
    }));

    const cashMovementRows = cashRows.map((c) => ({
      organization_id: organizationId,
      branch_code: s.id,
      branch_label: s.label,
      business_date: c.Fecha,
      fudo_cash_movement_id: c.Id,
      movement_type: c.Tipo,
      amount: c.Monto,
      comment: c.Comentario,
      payment_method: c["Medio de Pago"],
      cash_register: c.Caja,
      canceled: false,
      created_at_fudo: c.CreatedAt,
    }));

    for (const batch of chunk(paymentRows, 200)) {
      if (!batch.length) continue;
      const { error } = await admin
        .schema("fudo")
        .from("sale_payments")
        .upsert(batch, {
          onConflict: "organization_id,branch_code,fudo_payment_id",
        });
      if (error) throw new Error(`payments ${s.label}: ${error.message}`);
    }
    for (const batch of chunk(itemRows, 200)) {
      if (!batch.length) continue;
      const { error } = await admin
        .schema("fudo")
        .from("sale_items")
        .upsert(batch, {
          onConflict: "organization_id,branch_code,fudo_item_id",
        });
      if (error) throw new Error(`items ${s.label}: ${error.message}`);
    }
    for (const batch of chunk(expenseRows, 200)) {
      if (!batch.length) continue;
      const { error } = await admin
        .schema("fudo")
        .from("expenses")
        .upsert(batch, {
          onConflict: "organization_id,branch_code,fudo_expense_id",
        });
      if (error) throw new Error(`expenses ${s.label}: ${error.message}`);
    }
    for (const batch of chunk(cashMovementRows, 200)) {
      if (!batch.length) continue;
      const { error } = await admin
        .schema("fudo")
        .from("cash_movements")
        .upsert(batch, {
          onConflict: "organization_id,branch_code,fudo_cash_movement_id",
        });
      if (error) throw new Error(`cash ${s.label}: ${error.message}`);
    }

    const paySum = paymentRows.reduce((a, r) => a + Number(r.amount), 0);
    const expSum = expenseRows.reduce((a, r) => a + Number(r.amount), 0);
    const cashIn = cashMovementRows
      .filter((r) => r.movement_type === "income")
      .reduce((a, r) => a + Number(r.amount), 0);
    const cashOut = cashMovementRows
      .filter((r) => r.movement_type === "outcome")
      .reduce((a, r) => a + Number(r.amount), 0);

    return {
      branch: s.label,
      payments: paymentRows.length,
      items: itemRows.length,
      expenses: expenseRows.length,
      cashMovements: cashMovementRows.length,
      ventasTotal: paySum,
      gastosTotal: expSum,
      cashIn,
      cashOut,
    };
  }

  // Sucursales en serie (paralelo saturaba auth de Fudo con 429).
  // Dentro de cada sucursal, ventas/gastos/caja siguen en paralelo.
  for (const s of sucursales) {
    try {
      const row = await syncOneBranch(s);
      branchStats.push(row);
      stats.payments = Number(stats.payments) + row.payments;
      stats.items = Number(stats.items) + row.items;
      stats.expenses = Number(stats.expenses) + row.expenses;
      stats.cashMovements = Number(stats.cashMovements) + row.cashMovements;
    } catch (e) {
      errors.push(
        `${s.label}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  stats.branches = branchStats;
  if (branchStats.length > 0) {
    try {
      const posted = await applyFudoRenderedCash(admin, {
        organizationId,
        from: fromDate,
        to: toDate,
      });
      stats.cajaIngresos = posted.updated;
      stats.cajaLimpiados = posted.cleared;
    } catch (error) {
      errors.push(
        `Caja: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const status =
    errors.length === 0
      ? "ok"
      : branchStats.length > 0
        ? "partial"
        : "error";

  await admin
    .schema("fudo")
    .from("sync_runs")
    .update({
      status,
      stats,
      error: errors.length ? errors.join(" | ") : null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  return { runId: run.id, status, stats, errors };
}
