import * as XLSX from "xlsx";
import type {
  GastoExcelRow,
  MixDetalleRow,
  MixResumenRow,
  ProductoCatalogoRow,
  VentaExcelRow,
} from "@/lib/fudo/types";

function sheetFromRows<T extends object>(rows: T[], empty: T) {
  return XLSX.utils.json_to_sheet(rows.length ? rows : [empty]);
}

export function writeVentasXlsx(filePath: string, rows: VentaExcelRow[]) {
  const wb = XLSX.utils.book_new();
  const ws = sheetFromRows(rows, {
    Id: "",
    Sucursal: "Rg" as string,
    Fecha: "",
    "Medio de Pago": "",
    Total: 0,
  });
  XLSX.utils.book_append_sheet(wb, ws, "Ventas");
  XLSX.writeFile(wb, filePath);
}

export function writeGastosXlsx(filePath: string, rows: GastoExcelRow[]) {
  const wb = XLSX.utils.book_new();
  const ws = sheetFromRows(rows, {
    Id: "",
    Fecha: "",
    Sucursal: "Rg" as string,
    Origen: "Rg",
    Concepto: "",
    Descripción: "",
    "Cheques / Cargos": 0,
    "Medio de Pago": "",
    Proveedor: "",
  });
  XLSX.utils.book_append_sheet(wb, ws, "Egresos");
  XLSX.writeFile(wb, filePath);
}

export function writeMixXlsx(
  filePath: string,
  detalle: MixDetalleRow[],
  resumen: MixResumenRow[],
) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(resumen, {
      Sucursal: "Rg" as string,
      Producto: "",
      Categoría: "",
      Cantidad: 0,
      Total: 0,
    }),
    "Resumen",
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(detalle, {
      Fecha: "",
      Sucursal: "Rg" as string,
      "Id Venta": "",
      "Id Ítem": "",
      Producto: "",
      Categoría: "",
      Cantidad: 0,
      "Precio unitario": 0,
      "Total línea": 0,
      Comentario: "",
    }),
    "Detalle",
  );
  XLSX.writeFile(wb, filePath);
}

export function writeCatalogoXlsx(filePath: string, rows: ProductoCatalogoRow[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(rows, {
      Sucursal: "Rg" as string,
      "Id Producto": "",
      Código: "",
      Nombre: "",
      Categoría: "",
      Precio: 0,
      Costo: "",
      Activo: "",
      Stock: "",
    }),
    "Productos",
  );
  XLSX.writeFile(wb, filePath);
}
