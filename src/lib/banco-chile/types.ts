export type BancoMovimiento = {
  secuencial?: string;
  descripcionTransaccionCore?: string;
  descripcionCorta?: string;
  descripcionLarga?: string;
  indicadorCreditoDebito?: string;
  monto?: number | string;
  fechaContable?: string;
  fechaTransaccion?: string;
  idInternoTransaccion?: string;
  campoComplementario1?: string;
  campoComplementario6?: string;
  campoComplementario7?: string;
  campoComplementario8?: string;
};

export type BancoConsultaResponse = {
  glosaRespuesta?: string;
  numeroCuenta?: string;
  moneda?: string;
  saldoDisponible?: number;
  saldoContable?: number;
  indicadorMasPaginas?: string;
  indiceTerminoRespuesta?: number;
  cantidadRegistrosRespuesta?: number;
  movimientos?: BancoMovimiento[];
};

export type BancoConfig = {
  clientId: string;
  clientSecret: string;
  privateKeyPem: string;
  rutOrigen: string;
  rutApoderado: string;
  cuenta: string;
  productoCuenta: string;
  baseUrl: string;
  tokenUrl: string;
  audience: string;
};
