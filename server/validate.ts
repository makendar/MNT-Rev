export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const notFound = (what = "Record") => new HttpError(404, `${what} not found`);
export const forbidden = (msg = "You don't have permission for this action") => new HttpError(403, msg);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function str(v: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw bad(`${field} is required`);
    return "";
  }
  if (typeof v !== "string" && typeof v !== "number") throw bad(`${field} must be text`);
  const s = String(v).trim();
  if (opts.required && !s) throw bad(`${field} is required`);
  if (s.length > (opts.max ?? 500)) throw bad(`${field} is too long`);
  return s;
}

export function num(v: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): number {
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw bad(`${field} is required`);
    return 0;
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n)) throw bad(`${field} must be a number`);
  if (opts.min !== undefined && n < opts.min) throw bad(`${field} must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw bad(`${field} must be at most ${opts.max}`);
  return n;
}

export function date(v: unknown, field: string, required = false): string | null {
  if (v === undefined || v === null || v === "") {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  const s = String(v).slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(new Date(s).getTime())) throw bad(`${field} must be a date (YYYY-MM-DD)`);
  return s;
}

export function oneOf<T extends string>(v: unknown, field: string, values: readonly T[], fallback?: T): T {
  if ((v === undefined || v === null || v === "") && fallback) return fallback;
  if (!values.includes(v as T)) throw bad(`${field} must be one of: ${values.join(", ")}`);
  return v as T;
}

export function id(v: unknown, field = "id"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`Invalid ${field}`);
  return n;
}
