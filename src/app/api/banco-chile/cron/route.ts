import { NextResponse } from "next/server";

export const maxDuration = 60;

/**
 * Desactivado: Banco de Chile entra solo por Excel (cartolas / transferencias).
 * La API del banco devolvía datos incompletos / de prueba.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    disabled: true,
    message:
      "Banco de Chile ya no se actualiza por API. Usar los archivos Excel (enviar_finanzas).",
  });
}
