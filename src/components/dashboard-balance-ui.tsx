import { Building2, CreditCard, PiggyBank, Wallet } from "lucide-react";

export function BalanceMiniCard({
  label,
  compactLabel,
  amount,
  icon: Icon,
  accent = "cyan",
}: {
  label: string;
  compactLabel?: string;
  amount: string;
  icon: typeof Building2;
  accent?: "cyan" | "rose";
}) {
  const iconClass =
    accent === "rose"
      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-rose-500 shadow-sm sm:h-10 sm:w-10"
      : "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-cyan-500 shadow-sm sm:h-10 sm:w-10";
  return (
    <div className="flex min-w-0 items-start gap-1.5 rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-2 sm:gap-3 sm:rounded-xl sm:px-4 sm:py-4">
      <div className={iconClass}>
        <Icon className="h-3.5 w-3.5 sm:h-5 sm:w-5" strokeWidth={1.75} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium leading-snug text-slate-600 sm:text-sm">
          <span className="sm:hidden">{compactLabel ?? label}</span>
          <span className="hidden sm:inline">{label}</span>
        </p>
        <p className="mt-0.5 break-all text-[11px] font-bold leading-tight tabular-nums text-slate-900 sm:mt-1 sm:break-normal sm:text-[15px]">
          {amount}
        </p>
      </div>
    </div>
  );
}

export function BalanceSparkline({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 48"
      className={`h-12 w-full max-w-[220px] text-cyan-400 ${className}`.trim()}
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

export { Building2, CreditCard, PiggyBank, Wallet };
