import { Building2, PiggyBank, Wallet } from "lucide-react";

export function BalanceMiniCard({
  label,
  amount,
  icon: Icon,
}: {
  label: string;
  amount: string;
  icon: typeof Building2;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-cyan-500 shadow-sm">
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </div>
        <span className="text-sm font-medium text-slate-600">{label}</span>
      </div>
      <span className="shrink-0 text-right text-sm font-bold tabular-nums text-slate-900 sm:text-base">
        {amount}
      </span>
    </div>
  );
}

export function BalanceSparkline() {
  return (
    <svg
      viewBox="0 0 200 48"
      className="h-12 w-full max-w-[220px] text-cyan-400"
      aria-hidden
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 38 C 20 36, 35 28, 55 30 S 95 18, 115 22 S 155 8, 200 14 L 200 48 L 0 48 Z"
        fill="url(#spark-fill)"
      />
      <path
        d="M0 38 C 20 36, 35 28, 55 30 S 95 18, 115 22 S 155 8, 200 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { Building2, PiggyBank, Wallet };
