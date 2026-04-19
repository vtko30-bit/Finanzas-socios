import { createHash } from "crypto";

/** Hash estable para `transactions.dedupe_hash` (único por organización). */
export function dedupeHashManual(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}
