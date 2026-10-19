import type { BancoConsultaResponse, BancoMovimiento } from "@/lib/banco-chile/types";

export type BancoTxDraft = {
  date: string;
  type: "income" | "expense";
  amount: number;
  description: string;
  counterparty: string;
  payment_method: string;
  external_ref: string;
  origen_cuenta: string;
  concepto: string;
  source: "banco-chile";
  source_id: string;
  flow_kind: "operativo";
  dedupe_hash: string;
};

export function bancoFechaToISO(value: string): string {
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw.slice(0, 10);
}

export function cuentaLabel(numeroCuenta: string): string {
  const digits = numeroCuenta.replace(/\D/g, "");
  const tail = digits.slice(-4);
  return tail ? `Banco de Chile ···${tail}` : "Banco de Chile";
}

export function mapMovimiento(
  mov: BancoMovimiento,
  origenCuenta: string,
): BancoTxDraft | null {
  const amount = Number(mov.monto);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const credit = String(mov.indicadorCreditoDebito || "").toUpperCase() === "C";
  const date = bancoFechaToISO(String(mov.fechaContable || mov.fechaTransaccion || ""));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const secuencial = String(mov.secuencial || "").trim();
  const interno = String(mov.idInternoTransaccion || "").trim();
  const sourceId = secuencial || `${interno}:${date}:${amount}:${credit ? "C" : "D"}`;
  const counterparty = String(mov.campoComplementario6 || mov.campoComplementario1 || "").trim();
  const comment = String(mov.campoComplementario8 || "").trim();
  const title = String(
    mov.descripcionLarga ||
      mov.descripcionTransaccionCore ||
      mov.descripcionCorta ||
      "Movimiento Banco de Chile",
  ).trim();
  const core = String(mov.descripcionTransaccionCore || "");

  return {
    date,
    type: credit ? "income" : "expense",
    amount,
    description: comment ? `${title} · ${comment}` : title,
    counterparty,
    payment_method: /efectivo/i.test(core) ? "Efectivo" : "Transferencia",
    external_ref: String(mov.campoComplementario7 || interno).trim(),
    origen_cuenta: origenCuenta,
    concepto: String(mov.descripcionCorta || core).trim(),
    source: "banco-chile",
    source_id: sourceId,
    flow_kind: "operativo",
    dedupe_hash: `bch:${sourceId}`,
  };
}

export function mapConsulta(response: BancoConsultaResponse): BancoTxDraft[] {
  const origen = cuentaLabel(String(response.numeroCuenta || ""));
  const out: BancoTxDraft[] = [];
  for (const mov of response.movimientos ?? []) {
    const row = mapMovimiento(mov, origen);
    if (row) out.push(row);
  }
  return out;
}

export function nextPaginacionDesde(
  response: BancoConsultaResponse,
  current: number,
): number | null {
  const movements = response.movimientos?.length ?? 0;
  if (String(response.indicadorMasPaginas || "").toUpperCase() !== "Y") return null;
  if (movements === 0) return null;
  const end = Number(response.indiceTerminoRespuesta);
  if (Number.isFinite(end) && end > current) return end;
  const count = Number(response.cantidadRegistrosRespuesta);
  const step = Number.isFinite(count) && count > 0 ? count : movements;
  return current + step;
}
