"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useAuthState } from "@/hooks/use-auth-state";

export function RecurringObligationsWidget() {
  const { authenticated } = useAuthState();
  const [overdue, setOverdue] = useState(0);
  const [dueSoon, setDueSoon] = useState(0);
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pagos-recurrentes/status");
      const data = await res.json();
      if (!res.ok) return;
      const items = data.items ?? [];
      setOverdue(items.filter((i: { status: string }) => i.status === "overdue").length);
      setDueSoon(items.filter((i: { status: string }) => i.status === "due_soon").length);
      setCredits((data.creditDueSoon ?? []).length);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  if (!authenticated) return null;

  const total = overdue + dueSoon + credits;
  const hasAlert = overdue > 0 || dueSoon > 0 || credits > 0;

  return (
    <Link
      href="/pagos-recurrentes"
      className="group flex flex-col rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:border-cyan-200 hover:shadow-md sm:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-100">
          <CalendarClock className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </div>
        {hasAlert && !loading ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            {total} pendiente{total !== 1 ? "s" : ""}
          </span>
        ) : null}
      </div>
      <h2 className="mt-3 text-sm font-semibold text-slate-900 sm:text-base">
        Pagos recurrentes
      </h2>
      {loading ? (
        <p className="mt-1 text-xs text-slate-500">Cargando…</p>
      ) : (
        <p className="mt-1 text-xs leading-relaxed text-slate-500 sm:text-sm">
          {overdue > 0 ? (
            <span className="text-red-700 font-medium">{overdue} vencido{overdue !== 1 ? "s" : ""}</span>
          ) : null}
          {overdue > 0 && (dueSoon > 0 || credits > 0) ? " · " : null}
          {dueSoon > 0 ? (
            <span className="text-amber-800 font-medium">
              {dueSoon} próximo{dueSoon !== 1 ? "s" : ""}
            </span>
          ) : null}
          {dueSoon > 0 && credits > 0 ? " · " : null}
          {credits > 0 ? (
            <span>{credits} cuota{credits !== 1 ? "s" : ""} crédito</span>
          ) : null}
          {!hasAlert ? "Todo al día este mes" : null}
        </p>
      )}
    </Link>
  );
}
