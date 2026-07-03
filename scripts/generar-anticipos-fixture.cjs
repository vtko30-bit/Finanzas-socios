/**
 * Genera Anticipos_Consumo_Personal.xlsx con hoja Detalle para probar importación.
 * Uso: node scripts/generar-anticipos-fixture.cjs
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const fixturesDir = path.join(__dirname, "..", "fixtures");
fs.mkdirSync(fixturesDir, { recursive: true });

const stamp = Date.now();
const ws = XLSX.utils.aoa_to_sheet([
  ["Anticipos Consumo Personal", "", "", "", ""],
  [],
  ["Fecha", "Nombre", "Concepto", "Monto", "Observación"],
  ["2025-06-15", "Juan Pérez", "Anticipo", 50000 + (stamp % 1000), "Prueba import"],
  ["2025-06-20", "María López", "Consumo", 120000, "Supermercado"],
  ["Resumen", "", "", "", ""],
]);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Detalle");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Totales"]]), "Resumen");

const out = path.join(fixturesDir, "Anticipos_Consumo_Personal.xlsx");
XLSX.writeFile(wb, out);
console.log("Generado:", out);
