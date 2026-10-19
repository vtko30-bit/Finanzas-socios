import type { BancoConfig } from "@/lib/banco-chile/types";

const SANDBOX_BASE =
  "https://gw.apistore.bancochile.cl/banco-chile/sandbox/v1/movimientos-cuenta";
const PRODUCTION_BASE =
  "https://gw.apistore.bancochile.cl/banco-chile/v1/movimientos-cuenta";
const TOKEN_URL = "https://apistore.bancochile.auth0app.com/oauth/token";

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`Falta ${name} en el servidor de Finanzas`);
  return value;
}

export function bancoConfigFromEnv(): BancoConfig {
  const privateKey = (process.env.BANCO_CHILE_PRIVATE_KEY ?? "").trim().replace(/\\n/g, "\n");
  return {
    clientId: required("BANCO_CHILE_CLIENT_ID"),
    clientSecret: process.env.BANCO_CHILE_CLIENT_SECRET?.trim() ?? "",
    privateKeyPem: privateKey,
    rutOrigen: required("BANCO_CHILE_RUT_ORIGEN"),
    rutApoderado: required("BANCO_CHILE_RUT_APODERADO"),
    cuenta: required("BANCO_CHILE_CUENTA"),
    productoCuenta: process.env.BANCO_CHILE_PRODUCTO?.trim() || "CTD",
    baseUrl:
      process.env.BANCO_CHILE_BASE_URL?.trim() ||
      (privateKey ? PRODUCTION_BASE : SANDBOX_BASE),
    tokenUrl: process.env.BANCO_CHILE_TOKEN_URL?.trim() || TOKEN_URL,
    audience: process.env.BANCO_CHILE_AUDIENCE?.trim() || "https://openbanking/",
  };
}
