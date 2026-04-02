/** Errores típicos cuando el RPC no existe o PostgREST no lo tiene en caché. */
export function isMissingRpcError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the function") ||
    m.includes("schema cache") ||
    m.includes("pgrst202")
  );
}
