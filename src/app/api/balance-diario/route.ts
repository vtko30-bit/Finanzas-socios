import { NextResponse } from "next/server";
import {
  resolveOrganizationId,
  sendDailyBankPosition,
} from "@/lib/send-daily-balance";

function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : headerSecret;
  return Boolean(secret && token === secret);
}

/**
 * Cron: envía el Balance General (posición bancaria de la home) a cada socio.
 */
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const organizationId = await resolveOrganizationId();
    const report = await sendDailyBankPosition(organizationId);
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
