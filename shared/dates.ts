// Dates are handled as local calendar strings (YYYY-MM-DD) to avoid timezone drift.

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toISODate(new Date());
}

export function addDays(s: string, days: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(from: string, to: string): number {
  const ms = parseISODate(to).getTime() - parseISODate(from).getTime();
  return Math.round(ms / 86_400_000);
}

export interface Period {
  key: string;
  label: string;
  start: string;
  end: string;
}

/** Fiscal quarter containing `date`. Indian FY default: April–March. */
export function fiscalQuarter(date: string, fyStartMonth = 4): Period {
  const d = parseISODate(date);
  const m = d.getMonth() + 1;
  const offset = (m - fyStartMonth + 12) % 12;
  const q = Math.floor(offset / 3) + 1;
  const fyStartYear = m >= fyStartMonth ? d.getFullYear() : d.getFullYear() - 1;
  const startMonthIndex = fyStartMonth - 1 + (q - 1) * 3;
  const start = new Date(fyStartYear, startMonthIndex, 1);
  const end = new Date(fyStartYear, startMonthIndex + 3, 0);
  const fy = String((fyStartYear + 1) % 100).padStart(2, "0");
  return { key: `FY${fy}-Q${q}`, label: `Q${q} FY${fy}`, start: toISODate(start), end: toISODate(end) };
}

export function fiscalYear(date: string, fyStartMonth = 4): Period {
  const d = parseISODate(date);
  const m = d.getMonth() + 1;
  const fyStartYear = m >= fyStartMonth ? d.getFullYear() : d.getFullYear() - 1;
  const start = new Date(fyStartYear, fyStartMonth - 1, 1);
  const end = new Date(fyStartYear + 1, fyStartMonth - 1, 0);
  const fy = String((fyStartYear + 1) % 100).padStart(2, "0");
  return { key: `FY${fy}`, label: `FY${fy}`, start: toISODate(start), end: toISODate(end) };
}

export function shiftQuarter(p: Period, n: number, fyStartMonth = 4): Period {
  const d = parseISODate(p.start);
  d.setMonth(d.getMonth() + n * 3);
  return fiscalQuarter(toISODate(d), fyStartMonth);
}

/** Last `count` fiscal quarters ending with the one containing `date`. */
export function recentQuarters(date: string, count: number, fyStartMonth = 4): Period[] {
  const current = fiscalQuarter(date, fyStartMonth);
  const out: Period[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftQuarter(current, -i, fyStartMonth));
  return out;
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}
