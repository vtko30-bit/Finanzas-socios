type CacheEntry = {
  data: unknown;
  updatedAt: number;
};

const store = new Map<string, CacheEntry>();

/** Datos en memoria mientras la pestaña sigue abierta (sobrevive a cambios de ruta). */
export function getClientCache<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

export function setClientCache<T>(key: string, data: T): void {
  store.set(key, { data, updatedAt: Date.now() });
}

/** Borra una clave exacta o todas las que empiezan con el prefijo. */
export function invalidateClientCache(keyOrPrefix: string): void {
  if (store.has(keyOrPrefix)) {
    store.delete(keyOrPrefix);
    return;
  }
  for (const k of [...store.keys()]) {
    if (k.startsWith(keyOrPrefix)) store.delete(k);
  }
}

export function invalidateClientCaches(prefixes: string[]): void {
  for (const p of prefixes) invalidateClientCache(p);
}

/** Tras importar o borrar movimientos: forzar recarga en Gastos, Ventas y Resumen. */
export function invalidateMainNavCaches(): void {
  invalidateClientCaches([
    "/api/gastos/detalle",
    "/api/ventas/detalle",
    "/api/resumen/pivot",
    "/api/familias",
  ]);
}
