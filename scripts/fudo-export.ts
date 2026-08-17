/**
 * Exporta ventas, gastos, mix y catálogo Fudo de todas las sucursales activas.
 *
 * Uso:
 *   npx tsx scripts/fudo-export.ts --from 2026-07-28 --to 2026-07-28
 *   npx tsx scripts/fudo-export.ts --from 2026-07-28 --no-catalogo
 *
 * Env (.env.local):
 *   FUDO_BRANCHES=rg,happy
 *   FUDO_RG_API_KEY / FUDO_RG_API_SECRET [/ FUDO_RG_LABEL] [/ FUDO_RG_ACTIVE]
 *   FUDO_HAPPY_API_KEY / FUDO_HAPPY_API_SECRET [/ FUDO_HAPPY_LABEL] [/ FUDO_HAPPY_ACTIVE]
 *
 * Alta: agrega id a FUDO_BRANCHES + FUDO_<ID>_API_KEY/SECRET
 * Baja: FUDO_<ID>_ACTIVE=false (o quítalo de FUDO_BRANCHES)
 */
import fs from "node:fs";
import path from "node:path";
import { getActiveFudoSucursales } from "../src/lib/fudo/branches";
import { FudoClient } from "../src/lib/fudo/client";
import {
  aggregateMixResumen,
  mapExpensesToGastoRows,
  mapProductsToCatalogoRows,
  mapSalesToMixDetalleRows,
  mapSalesToVentasRows,
  summarizeGastos,
  summarizeMix,
  summarizeVentas,
} from "../src/lib/fudo/map";
import {
  writeCatalogoXlsx,
  writeGastosXlsx,
  writeMixXlsx,
  writeVentasXlsx,
} from "../src/lib/fudo/write-xlsx";
import type {
  FudoBranch,
  GastoExcelRow,
  MixDetalleRow,
  ProductoCatalogoRow,
  VentaExcelRow,
} from "../src/lib/fudo/types";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(argv: string[]) {
  let from = "";
  let to = "";
  let outDir = path.join(process.cwd(), "tmp", "fudo-export");
  let withCatalogo = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") from = argv[++i] ?? "";
    else if (a === "--to") to = argv[++i] ?? "";
    else if (a === "--out") outDir = argv[++i] ?? outDir;
    else if (a === "--no-catalogo") withCatalogo = false;
    else if (a === "--help" || a === "-h") {
      console.log(
        `Uso: npx tsx scripts/fudo-export.ts --from YYYY-MM-DD [--to YYYY-MM-DD] [--out dir] [--no-catalogo]`,
      );
      process.exit(0);
    }
  }
  if (!from) {
    console.error("Falta --from YYYY-MM-DD");
    process.exit(1);
  }
  if (!to) to = from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error("Fechas inválidas; usa YYYY-MM-DD");
    process.exit(1);
  }
  if (from > to) {
    console.error("--from no puede ser posterior a --to");
    process.exit(1);
  }
  return { from, to, outDir, withCatalogo };
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function inDateRange(fecha: string, from: string, to: string) {
  return fecha >= from && fecha <= to;
}

async function exportBranch(
  label: FudoBranch,
  client: FudoClient,
  from: string,
  to: string,
  withCatalogo: boolean,
): Promise<{
  ventas: VentaExcelRow[];
  gastos: GastoExcelRow[];
  mix: MixDetalleRow[];
  catalogo: ProductoCatalogoRow[];
}> {
  const salesFrom = `${addDays(from, -1)}T00:00:00Z`;
  const salesTo = `${addDays(to, 2)}T00:00:00Z`;
  const expFrom = addDays(from, -1);
  const expTo = addDays(to, 1);

  console.log(`[${label}] bajando ventas+ítems ${salesFrom} .. ${salesTo}`);
  const sales = await client.fetchClosedSales(salesFrom, salesTo);
  const ventas = mapSalesToVentasRows(label, sales).filter((r) =>
    inDateRange(r.Fecha, from, to),
  );
  const mix = mapSalesToMixDetalleRows(label, sales).filter((r) =>
    inDateRange(r.Fecha, from, to),
  );

  console.log(`[${label}] bajando gastos ${expFrom} .. ${expTo}`);
  const expenses = await client.fetchExpenses(expFrom, expTo);
  const gastos = mapExpensesToGastoRows(label, expenses).filter((r) =>
    inDateRange(r.Fecha, from, to),
  );

  let catalogo: ProductoCatalogoRow[] = [];
  if (withCatalogo) {
    console.log(`[${label}] bajando catálogo de productos`);
    const products = await client.fetchProducts();
    catalogo = mapProductsToCatalogoRows(label, products);
  }

  return { ventas, gastos, mix, catalogo };
}

function formatMoney(n: number) {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env"));

  const { from, to, outDir, withCatalogo } = parseArgs(process.argv.slice(2));
  const sucursales = getActiveFudoSucursales();
  console.log(
    `Sucursales activas: ${sucursales.map((s) => s.label).join(", ")}`,
  );

  const results = await Promise.allSettled(
    sucursales.map((s) =>
      exportBranch(
        s.label,
        new FudoClient(s.credentials),
        from,
        to,
        withCatalogo,
      ),
    ),
  );

  const ventas: VentaExcelRow[] = [];
  const gastos: GastoExcelRow[] = [];
  const mix: MixDetalleRow[] = [];
  const catalogo: ProductoCatalogoRow[] = [];

  for (let i = 0; i < results.length; i++) {
    const label = sucursales[i].label;
    const r = results[i];
    if (r.status === "fulfilled") {
      ventas.push(...r.value.ventas);
      gastos.push(...r.value.gastos);
      mix.push(...r.value.mix);
      catalogo.push(...r.value.catalogo);
    } else {
      const msg =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.error(`[${label}] ERROR: ${msg}`);
    }
  }

  if (!ventas.length && !gastos.length && !mix.length) {
    console.error("No se pudo exportar ninguna sucursal.");
    process.exit(1);
  }

  const mixResumen = aggregateMixResumen(mix);

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = from === to ? from : `${from}_${to}`;
  const ventasPath = path.join(outDir, `ventas-${stamp}.xlsx`);
  const gastosPath = path.join(outDir, `gastos-${stamp}.xlsx`);
  const mixPath = path.join(outDir, `mix-productos-${stamp}.xlsx`);
  const catalogoPath = path.join(outDir, `catalogo-productos-${stamp}.xlsx`);

  writeVentasXlsx(ventasPath, ventas);
  writeGastosXlsx(gastosPath, gastos);
  writeMixXlsx(mixPath, mix, mixResumen);
  if (withCatalogo) writeCatalogoXlsx(catalogoPath, catalogo);

  const vs = summarizeVentas(ventas);
  const gs = summarizeGastos(gastos);
  const ms = summarizeMix(mix);

  console.log("\n=== Ventas ===");
  console.log(`Filas: ${vs.count}  Total: $${formatMoney(vs.total)}`);
  console.log("Por sucursal:", vs.byBranch);
  console.log("Por medio:", vs.byMedio);
  console.log(`Archivo: ${ventasPath}`);

  console.log("\n=== Gastos ===");
  console.log(`Filas: ${gs.count}  Total: $${formatMoney(gs.total)}`);
  console.log("Por sucursal:", gs.byBranch);
  console.log(`Archivo: ${gastosPath}`);

  console.log("\n=== Mix productos ===");
  console.log(
    `Líneas: ${ms.count}  Cantidad: ${ms.qty}  Total líneas: $${formatMoney(ms.total)}`,
  );
  console.log("Por sucursal:", ms.byBranch);
  console.log(`Productos distintos (resumen): ${mixResumen.length}`);
  console.log(`Archivo: ${mixPath}`);
  if (mixResumen[0]) {
    console.log(
      `Top: ${mixResumen[0].Sucursal} · ${mixResumen[0].Producto} · $${formatMoney(mixResumen[0].Total)}`,
    );
  }

  if (withCatalogo) {
    console.log("\n=== Catálogo ===");
    console.log(`Productos: ${catalogo.length}`);
    console.log(`Archivo: ${catalogoPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
