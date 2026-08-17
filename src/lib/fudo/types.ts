/** Nombre de sucursal en Excel (Rg, Happy, u otras). */
export type FudoBranch = string;

export type FudoCredentials = {
  apiKey: string;
  apiSecret: string;
};

export type FudoJsonApiResource = {
  id: string;
  type: string;
  attributes?: Record<string, unknown> | null;
  relationships?: Record<
    string,
    {
      data?:
        | { type: string; id: string }
        | Array<{ type: string; id: string }>
        | null;
    }
  >;
};

export type FudoListResponse = {
  data: FudoJsonApiResource[];
  included?: FudoJsonApiResource[];
};

export type VentaExcelRow = {
  Id: string;
  Sucursal: FudoBranch;
  Fecha: string;
  "Medio de Pago": string;
  Total: number;
};

export type MixDetalleRow = {
  Fecha: string;
  Sucursal: FudoBranch;
  "Id Venta": string;
  "Id Ítem": string;
  Producto: string;
  Categoría: string;
  Cantidad: number;
  "Precio unitario": number;
  "Total línea": number;
  Comentario: string;
};

export type MixResumenRow = {
  Sucursal: FudoBranch;
  Producto: string;
  Categoría: string;
  Cantidad: number;
  Total: number;
};

export type ProductoCatalogoRow = {
  Sucursal: FudoBranch;
  "Id Producto": string;
  Código: string;
  Nombre: string;
  Categoría: string;
  Precio: number;
  Costo: number | "";
  Activo: string;
  Stock: number | "";
};

export type GastoExcelRow = {
  Id: string;
  Fecha: string;
  Sucursal: FudoBranch;
  Origen: FudoBranch;
  /** Categoría del gasto (nombre histórico de columna Excel). */
  Concepto: string;
  Descripción: string;
  "Cheques / Cargos": number;
  "Medio de Pago": string;
  Proveedor: string;
};

export type CashMovementRow = {
  Id: string;
  Fecha: string;
  Sucursal: FudoBranch;
  Tipo: "income" | "outcome";
  Monto: number;
  Comentario: string;
  "Medio de Pago": string;
  Caja: string;
  CreatedAt: string | null;
};
