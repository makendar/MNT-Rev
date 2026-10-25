const inrFull = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Full INR with Indian digit grouping, e.g. ₹12,50,000 */
export function inr(n: number): string {
  return inrFull.format(Math.round(n || 0));
}

/** Compact INR using lakh / crore, e.g. ₹12.5 L, ₹1.25 Cr */
export function inrCompact(n: number): string {
  const v = n || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7, 2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5, 1)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3, 1)} K`;
  return `${sign}₹${Math.round(abs)}`;
}

function trim(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString();
}

export function pct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtShortDate(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
