import { createSign, randomUUID } from "node:crypto";
import { nextPaginacionDesde } from "@/lib/banco-chile/map";
import type { BancoConfig, BancoConsultaResponse } from "@/lib/banco-chile/types";

const USER_AGENT = "CLIENTE_APISTORE";

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function clientAssertion(config: BancoConfig, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: config.clientId,
      sub: config.clientId,
      aud: config.tokenUrl,
      iat: nowSec,
      exp: nowSec + 300,
      jti: randomUUID(),
    }),
  );
  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  const signature = sign.sign(config.privateKeyPem).toString("base64url");
  return `${data}.${signature}`;
}

export async function fetchAccessToken(
  config: BancoConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  // En sandbox el portal no emite un token OAuth. La cartola acepta las claves
  // en los encabezados y cualquier Bearer. Producción firma un JWT con el PEM.
  if (!config.privateKeyPem) return "sandbox";

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    audience: config.audience,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion(config),
  });

  const res = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
    },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`Banco de Chile no entregó token: ${detail}`);
  }
  return json.access_token;
}

async function postConsulta(
  config: BancoConfig,
  token: string,
  fechaDesde: string,
  fechaHasta: string,
  paginacionDesde: number,
  fetchImpl: typeof fetch,
): Promise<BancoConsultaResponse> {
  const res = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/obtener-periodo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "user-agent": USER_AGENT,
      "client-id": config.clientId,
      ...(config.clientSecret ? { "client-secret": config.clientSecret } : {}),
    },
    body: JSON.stringify({
      rutOrigen: config.rutOrigen,
      productoCuenta: config.productoCuenta,
      cuenta: config.cuenta,
      rutApoderado: [{ value: config.rutApoderado }],
      fechaDesde,
      fechaHasta,
      paginacionDesde,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as BancoConsultaResponse & {
    errors?: { userMessage?: string; developerMessage?: string }[];
  };
  if (!res.ok) {
    const detail =
      json.errors?.[0]?.userMessage || json.errors?.[0]?.developerMessage || `HTTP ${res.status}`;
    throw new Error(`Consulta de movimientos rechazada: ${detail}`);
  }
  return json;
}

export async function fetchMovimientosPeriodo(
  config: BancoConfig,
  fechaDesde: string,
  fechaHasta: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BancoConsultaResponse> {
  const token = await fetchAccessToken(config, fetchImpl);
  const merged: BancoConsultaResponse = { movimientos: [] };
  let cursor = 0;
  for (let page = 0; page < 40; page++) {
    const chunk = await postConsulta(config, token, fechaDesde, fechaHasta, cursor, fetchImpl);
    merged.glosaRespuesta = chunk.glosaRespuesta;
    merged.numeroCuenta = chunk.numeroCuenta || config.cuenta;
    merged.moneda = chunk.moneda;
    merged.saldoDisponible = chunk.saldoDisponible;
    merged.saldoContable = chunk.saldoContable;
    merged.movimientos = [...(merged.movimientos ?? []), ...(chunk.movimientos ?? [])];
    const next = nextPaginacionDesde(chunk, cursor);
    if (next == null) break;
    cursor = next;
  }
  return merged;
}
