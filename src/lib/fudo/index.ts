export {
  FudoClient,
  relId,
  relIds,
  resolveIncluded,
  resolveRel,
} from "@/lib/fudo/client";
export {
  getActiveFudoSucursales,
  loadFudoSucursales,
} from "@/lib/fudo/branches";
export type { FudoSucursal } from "@/lib/fudo/branches";
export {
  aggregateMixResumen,
  mapExpensesToGastoRows,
  mapProductsToCatalogoRows,
  mapSalesToMixDetalleRows,
  mapSalesToVentasRows,
  summarizeGastos,
  summarizeMix,
  summarizeVentas,
  toDateOnly,
  fudoGastoOrigen,
} from "@/lib/fudo/map";
export {
  writeCatalogoXlsx,
  writeGastosXlsx,
  writeMixXlsx,
  writeVentasXlsx,
} from "@/lib/fudo/write-xlsx";
export {
  syncVentasFudoFromRange,
  assertVentasSyncRange,
} from "@/lib/fudo/sync-ventas";
export {
  syncGastosFudoFromRange,
  assertGastosSyncRange,
} from "@/lib/fudo/sync-gastos";
export type {
  FudoBranch,
  FudoCredentials,
  GastoExcelRow,
  MixDetalleRow,
  MixResumenRow,
  ProductoCatalogoRow,
  VentaExcelRow,
} from "@/lib/fudo/types";
