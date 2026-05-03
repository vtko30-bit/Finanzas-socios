/**
 * Genera un .xlsx mínimo con hoja "Egresos" válido para POST /api/import/consolidado.
 * Uso: node scripts/generar-prueba-import-consolidado.cjs
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const fixturesDir = path.join(__dirname, "..", "fixtures");
fs.mkdirSync(fixturesDir, { recursive: true });

const stamp = Date.now();
const idEstable = 4503599627370496 + (stamp % 1_000_000);
const op = `OP-PRUEBA-${stamp}`;

const ws = XLSX.utils.aoa_to_sheet([
  [
    "Id",
    "Fecha",
    "Sucursal",
    "N° Cuenta",
    "Concepto",
    "Origen",
    "Descripción",
    "Cheques / Cargos",
    "Depósitos / Abonos",
    "N° Operación",
  ],
  [
    idEstable,
    "2026-04-27",
    "Prueba",
    "12345678",
    "Varios",
    "Movimientos Banco estado",
    `Import de prueba (${stamp})`,
    1500,
    "",
    op,
  ],
]);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Egresos");

const out = path.join(fixturesDir, "prueba-import-consolidado.xlsx");
XLSX.writeFile(wb, out);
console.log("Generado:", out);
console.log("Id fila:", idEstable, "| N° Operación:", op);
