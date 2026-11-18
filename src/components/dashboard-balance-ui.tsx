import { Building2, CreditCard, PiggyBank, Wallet } from "lucide-react";

type Accent = "orange" | "green" | "blue" | "rose";

const ACCENT_STYLES: Record<
  Accent,
  { wrap: string; icon: string }
> = {
  orange: {
    wrap: "bg-[#fbe7d8] text-[#e85e00]",
    icon: "text-[#e85e00]",
  },
  green: {
    wrap: "bg-emerald-50 text-emerald-600",
    icon: "text-emerald-600",
  },
  blue: {
    wrap: "bg-sky-50 text-sky-600",
    icon: "text-sky-600",
  },
  rose: {
    wrap: "bg-rose-50 text-rose-600",
    icon: "text-rose-600",
  },
};

export function BalanceMiniCard({
  label,
  compactLabel,
  amount,
  icon: Icon,
  accent = "orange",
}: {
  label: string;
  compactLabel?: string;
  amount: string;
  icon: typeof Building2;
  accent?: Accent;
}) {
  const tone = ACCENT_STYLES[accent];
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-stone-200/80 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
      <div
        className={`absolute right-3 top-3 flex size-9 items-center justify-center rounded-full sm:right-4 sm:top-4 sm:size-10 ${tone.wrap}`}
      >
        <Icon
          className={`h-4 w-4 sm:h-5 sm:w-5 ${tone.icon}`}
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
      <div className="min-w-0 pr-11 sm:pr-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500 sm:text-xs">
          <span className="sm:hidden">{compactLabel ?? label}</span>
          <span className="hidden sm:inline">{label}</span>
        </p>
        <p className="mt-2 whitespace-nowrap text-[clamp(0.95rem,3.6vw,1.5rem)] font-bold leading-none tabular-nums text-stone-900 sm:mt-3">
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
      className={`h-12 w-full max-w-[220px] text-[#e85e00] ${className}`.trim()}
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
