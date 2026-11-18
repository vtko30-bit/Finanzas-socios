"use client";

import { BankPositionSection } from "@/components/bank-position-section";
import { RecurringObligationsWidget } from "@/components/recurring-obligations-widget";

export function DashboardHome() {
  return (
    <main className="page-main page-main--xl gap-3 pt-3 pb-6 sm:gap-8 sm:pt-5 sm:pb-8">
      <BankPositionSection variant="premium" />

      <section className="mb-1 sm:mb-2">
        <RecurringObligationsWidget />
      </section>
    </main>
  );
}
