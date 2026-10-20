import { NextResponse } from "next/server";
import { resolveOrganizationId } from "@/lib/send-daily-balance";
import { sendDailySales } from "@/lib/send-daily-sales";

function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : headerSecret.trim();
  return Boolean(secret && token === secret);
}

/** Cron: ventas de ayer de cada local, a cada socio. */
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const organizationId = await resolveOrganizationId();
    const report = await sendDailySales(organizationId);
    const sent = report.recipients.filter((row) => row.ok).length;
    console.info(
      "[ventas-diarias]",
      JSON.stringify({ fecha: report.fecha, sent, locales: report.locales }),
    );
    if (!sent) {
      return NextResponse.json(
        { error: "No se envió ningún correo", ...report },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("[ventas-diarias]", e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
