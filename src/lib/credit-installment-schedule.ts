/** Utilidades para armar el plan de cuotas de un crédito recibido. */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Reparte `total` en `parts` partes casi iguales; la última absorbe el redondeo. */
export function splitTotalEqual(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = round2(total / parts);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < parts - 1; i++) {
    out.push(base);
    acc = round2(acc + base);
  }
  out.push(round2(total - acc));
  return out;
}

/**
 * Reparte `total` en partes proporcionales a `weights` (no tienen que sumar 1).
 * Ajusta el redondeo en la última posición.
 */
export function splitByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const s = weights.reduce((a, b) => a + b, 0);
  if (s <= 0) {
    const eq = weights.length ? round2(total / weights.length) : 0;
    const out = weights.map((_, i) =>
      i === weights.length - 1 ? round2(total - eq * (weights.length - 1)) : eq,
    );
    return out;
  }
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < weights.length - 1; i++) {
    const v = round2((total * weights[i]) / s);
    out.push(v);
    acc = round2(acc + v);
  }
  out.push(round2(total - acc));
  return out;
}

export type InstallmentScheduleRow = {
  installment_number: number;
  principal_amount: number;
  interest_amount: number;
  fee_amount: number;
  total_amount: number;
};

/**
 * Plan estándar: principal e interés repartidos en partes iguales por período.
 */
export function scheduleEqualParts(args: {
  totalInstallments: number;
  principal: number;
  interestTotal: number;
  feePerInstallment: number;
}): InstallmentScheduleRow[] {
  const n = args.totalInstallments;
  const principalParts = splitTotalEqual(args.principal, n);
  const interestParts =
    args.interestTotal > 0
      ? splitTotalEqual(args.interestTotal, n)
      : principalParts.map(() => 0);
  const fee = args.feePerInstallment > 0 ? round2(args.feePerInstallment) : 0;

  return principalParts.map((p, i) => {
    const intr = interestParts[i] ?? 0;
    const totalAmt = round2(p + intr + fee);
    return {
      installment_number: i + 1,
      principal_amount: p,
      interest_amount: intr,
      fee_amount: fee,
      total_amount: totalAmt,
    };
  });
}

/**
 * Primera cuota con total distinto y el resto con el mismo total (cuotas fijas).
 * `targets[i]` = monto total a pagar en la cuota i+1 (incluye comisión por cuota si aplica).
 */
export function scheduleFirstAndRecurring(args: {
  totalInstallments: number;
  principal: number;
  interestTotal: number;
  feePerInstallment: number;
  firstTotal: number;
  recurringTotal: number;
}): InstallmentScheduleRow[] {
  const n = args.totalInstallments;
  if (n < 1) return [];

  const fee = args.feePerInstallment > 0 ? round2(args.feePerInstallment) : 0;
  const targets: number[] =
    n === 1
      ? [round2(args.firstTotal)]
      : [round2(args.firstTotal), ...Array.from({ length: n - 1 }, () => round2(args.recurringTotal))];

  const nets = targets.map((t) => round2(t - fee));
  if (nets.some((x) => x < 0)) {
    throw new Error("El total de alguna cuota es menor que la comisión por cuota.");
  }

  const sumNet = round2(nets.reduce((a, b) => a + b, 0));
  const sumPI = round2(args.principal + args.interestTotal);
  if (Math.abs(sumNet - sumPI) > Math.max(0.05, 0.0001 * Math.max(sumPI, 1))) {
    throw new Error(
      `La suma de (cuota − comisión) debe ser ${sumPI}. Obtenido ${sumNet}. Revise primera cuota, cuota fija, principal e interés total.`,
    );
  }

  const principalParts = splitByWeights(args.principal, nets);
  const interestParts = splitByWeights(args.interestTotal, nets);

  return targets.map((totalAmt, i) => ({
    installment_number: i + 1,
    principal_amount: principalParts[i] ?? 0,
    interest_amount: interestParts[i] ?? 0,
    fee_amount: fee,
    total_amount: round2(totalAmt),
  }));
}
