import { Router } from "express";
import { fiscalQuarter, recentQuarters, shiftQuarter, today } from "../../shared/dates.ts";
import { isOpen } from "../../shared/scoring.ts";
import { LOST_REASONS, SOURCES } from "../../shared/types.ts";
import { aiStatus } from "../ai.ts";
import { canSeeAll, createSession, destroySession, hashPassword, requireRole, verifyPassword } from "../auth.ts";
import { all, audit, get, run, tx } from "../db.ts";
import { seed } from "../seed.ts";
import { getOrg, getStages, loadDeals } from "../services/deals.ts";
import { bad, id, num, oneOf, str } from "../validate.ts";

export const authRouter = Router();
export const adminRouter = Router();

// ---------- Auth (public) ----------

const attempts = new Map<string, { n: number; until: number }>();

authRouter.post("/auth/login", (req, res) => {
  const email = str(req.body?.email, "Email", { required: true, max: 160 }).toLowerCase();
  const password = str(req.body?.password, "Password", { required: true, max: 200 });
  const a = attempts.get(email);
  if (a && a.until > Date.now()) return res.status(429).json({ error: "Too many attempts. Try again in a minute." });
  const user = get("SELECT * FROM users WHERE lower(email) = ? AND active = 1", email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(email, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    return res.status(401).json({ error: "Email or password is incorrect" });
  }
  attempts.delete(email);
  const token = createSession(user.id);
  res.setHeader("Set-Cookie", `mnt_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}`);
  audit(user.org_id, user.id, "session", null, "login");
  res.json({ ok: true });
});

const DEMO_MODE = process.env.MNT_DEMO !== "false";

authRouter.get("/auth/demo-accounts", (_req, res) => {
  if (!DEMO_MODE) return void res.json([]);
  res.json(all("SELECT name, email, role, title FROM users WHERE active = 1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name LIMIT 6"));
});

// ---------- Authenticated (requireAuth is applied where the router is mounted) ----------

adminRouter.post("/auth/logout", (req, res) => {
  destroySession(req.token);
  res.setHeader("Set-Cookie", "mnt_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

adminRouter.get("/auth/me", (req, res) => res.json(req.user));

adminRouter.get("/meta", (req, res) => {
  const org = getOrg(req.user.org_id);
  const T = today();
  res.json({
    org,
    today: T,
    currentPeriod: fiscalQuarter(T, org.fy_start_month),
    stages: getStages(req.user.org_id),
    users: all("SELECT id, name, email, role, title, team_id, active FROM users WHERE org_id = ? ORDER BY name", req.user.org_id),
    teams: all("SELECT * FROM teams WHERE org_id = ?", req.user.org_id),
    sources: SOURCES,
    lostReasons: LOST_REASONS,
    productLines: all<{ p: string }>("SELECT DISTINCT product_line p FROM deals WHERE org_id = ? AND product_line != '' ORDER BY p", req.user.org_id).map((r) => r.p),
    ai: aiStatus(),
  });
});

// ---------- Settings ----------

adminRouter.put("/settings/stages", requireRole("owner", "manager"), (req, res) => {
  const list = req.body?.stages;
  if (!Array.isArray(list)) throw bad("stages must be a list");
  const stages = getStages(req.user.org_id);
  tx(() => {
    for (const s of list) {
      const existing = stages.find((x) => x.id === Number(s.id));
      if (!existing) throw bad("Unknown stage");
      if (!isOpen(existing)) continue;
      run(
        "UPDATE stages SET name = ?, probability = ?, expected_days = ? WHERE id = ?",
        str(s.name, "Stage name", { required: true, max: 40 }),
        num(s.probability, "Probability", { min: 0, max: 1, required: true }),
        Math.round(num(s.expected_days, "Expected days", { min: 1, max: 365, required: true })),
        existing.id,
      );
    }
  });
  audit(req.user.org_id, req.user.id, "settings", null, "update_stages");
  res.json({ ok: true });
});

adminRouter.get("/targets", (req, res) => {
  const org = getOrg(req.user.org_id);
  const current = fiscalQuarter(today(), org.fy_start_month);
  const periods = [...recentQuarters(today(), 3, org.fy_start_month), shiftQuarter(current, 1, org.fy_start_month), shiftQuarter(current, 2, org.fy_start_month)];
  const rows = all("SELECT user_id, period_key, amount FROM targets WHERE org_id = ?", req.user.org_id);
  res.json({ periods, current: current.key, targets: rows });
});

adminRouter.put("/targets", requireRole("owner", "manager"), (req, res) => {
  const b = req.body ?? {};
  const periodKey = str(b.period_key, "Period", { required: true, max: 20 });
  if (!/^FY\d{2}-Q[1-4]$/.test(periodKey)) throw bad("Invalid period");
  const userId = b.user_id ? id(b.user_id, "user") : null;
  if (userId && !get("SELECT id FROM users WHERE id = ? AND org_id = ?", userId, req.user.org_id)) throw bad("Unknown user");
  const amount = num(b.amount, "Target", { min: 0, max: 1e12, required: true });
  run(
    `INSERT INTO targets (org_id, user_id, period_key, amount) VALUES (?,?,?,?)
     ON CONFLICT (org_id, user_id, period_key) DO UPDATE SET amount = excluded.amount`,
    req.user.org_id, userId, periodKey, amount,
  );
  // SQLite treats NULLs as distinct in UNIQUE constraints, so company targets need a manual upsert.
  if (userId === null) {
    const rows = all("SELECT id FROM targets WHERE org_id = ? AND user_id IS NULL AND period_key = ? ORDER BY id", req.user.org_id, periodKey);
    for (const r of rows.slice(0, -1)) run("DELETE FROM targets WHERE id = ?", r.id);
  }
  audit(req.user.org_id, req.user.id, "target", userId, "set", `${periodKey}: ${amount}`);
  res.json({ ok: true });
});

adminRouter.post("/users", requireRole("owner"), (req, res) => {
  const b = req.body ?? {};
  const email = str(b.email, "Email", { required: true, max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Email address looks invalid");
  if (get("SELECT id FROM users WHERE lower(email) = ?", email)) throw bad("A user with this email already exists");
  const password = str(b.password, "Password", { required: true, max: 200 });
  if (password.length < 8) throw bad("Password must be at least 8 characters");
  const r = run(
    "INSERT INTO users (org_id, team_id, name, email, password_hash, role, title) VALUES (?,?,?,?,?,?,?)",
    req.user.org_id,
    b.team_id ? id(b.team_id, "team") : null,
    str(b.name, "Name", { required: true, max: 120 }),
    email,
    hashPassword(password),
    oneOf(b.role, "Role", ["owner", "manager", "rep"] as const, "rep"),
    str(b.title, "Title", { max: 120 }),
  );
  audit(req.user.org_id, req.user.id, "user", Number(r.lastInsertRowid), "create", email);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

adminRouter.patch("/users/:id", requireRole("owner"), (req, res) => {
  const u = get("SELECT * FROM users WHERE id = ? AND org_id = ?", id(req.params.id), req.user.org_id);
  if (!u) throw bad("Unknown user");
  if (u.id === req.user.id && (req.body?.active === false || (req.body?.role && req.body.role !== "owner"))) throw bad("You can't deactivate or demote yourself");
  if ("active" in (req.body ?? {})) run("UPDATE users SET active = ? WHERE id = ?", req.body.active ? 1 : 0, u.id);
  if (req.body?.role) run("UPDATE users SET role = ? WHERE id = ?", oneOf(req.body.role, "Role", ["owner", "manager", "rep"] as const), u.id);
  if (req.body?.active === false) run("DELETE FROM sessions WHERE user_id = ?", u.id);
  audit(req.user.org_id, req.user.id, "user", u.id, "update", JSON.stringify(req.body));
  res.json({ ok: true });
});

adminRouter.get("/audit", requireRole("owner", "manager"), (req, res) => {
  res.json(
    all(
      `SELECT l.*, u.name user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.org_id = ? ORDER BY l.id DESC LIMIT 150`,
      req.user.org_id,
    ),
  );
});

adminRouter.post("/demo/reset", requireRole("owner"), (_req, res) => {
  if (!DEMO_MODE) return void res.status(403).json({ error: "Demo reset is disabled (MNT_DEMO=false)." });
  seed();
  res.json({ ok: true });
});

// ---------- Import / export ----------

interface ImportRow {
  account_name?: string;
  deal_name?: string;
  amount?: string;
  stage?: string;
  owner_email?: string;
  expected_close_date?: string;
  source?: string;
  product_line?: string;
  contact_name?: string;
  contact_email?: string;
  contact_title?: string;
  next_step?: string;
}

/** Accepts DD/MM/YYYY (common in India), DD-MM-YYYY and YYYY-MM-DD. */
function normaliseDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Accepts plain numbers, Indian grouping (12,50,000) and lakh / crore suffixes. */
function normaliseAmount(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.toLowerCase().replace(/[₹,\s]|inr|rs\.?/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(cr|crore|l|lakh|lac|k)?$/);
  if (!m) return null;
  const mult = { cr: 1e7, crore: 1e7, l: 1e5, lakh: 1e5, lac: 1e5, k: 1e3 }[m[2] as "cr"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

adminRouter.post("/import/deals", (req, res) => {
  const rows: ImportRow[] = req.body?.rows;
  const dryRun = !!req.body?.dryRun;
  if (!Array.isArray(rows) || !rows.length) throw bad("No rows to import");
  if (rows.length > 5000) throw bad("Import is limited to 5,000 rows at a time");
  const stages = getStages(req.user.org_id);
  const users = all("SELECT id, lower(email) email FROM users WHERE org_id = ? AND active = 1", req.user.org_id);
  const T = today();

  const results = rows.map((r, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const account = r.account_name?.trim();
    const name = r.deal_name?.trim() || (account ? `${account} – ${r.product_line?.trim() || "New opportunity"}` : "");
    if (!account) errors.push("Account name is missing");
    const amount = normaliseAmount(r.amount);
    if (amount === null) errors.push(`Amount "${r.amount ?? ""}" is not a number`);
    const close = normaliseDate(r.expected_close_date);
    if (!close) errors.push(`Close date "${r.expected_close_date ?? ""}" is not a valid date`);
    let stage = stages.find((s) => s.name.toLowerCase() === r.stage?.trim().toLowerCase());
    if (!stage) {
      if (r.stage) warnings.push(`Stage "${r.stage}" not recognised — set to ${stages[0].name}`);
      stage = stages[0];
    }
    let ownerId = req.user.id;
    if (r.owner_email) {
      const u = users.find((x) => x.email === r.owner_email!.trim().toLowerCase());
      if (u) ownerId = u.id;
      else warnings.push(`Owner ${r.owner_email} not found — assigned to you`);
    }
    if (!canSeeAll(req.user)) ownerId = req.user.id;
    const source = SOURCES.find((s) => s.toLowerCase() === r.source?.trim().toLowerCase()) ?? "";
    if (r.source && !source) warnings.push(`Source "${r.source}" not recognised — left blank`);
    return { row: i + 1, errors, warnings, data: { account, name, amount, close, stage, ownerId, source, r } };
  });

  const valid = results.filter((r) => !r.errors.length);
  let created = 0;
  if (!dryRun && valid.length) {
    tx(() => {
      for (const { data } of valid) {
        let acc = get("SELECT id FROM accounts WHERE org_id = ? AND lower(name) = lower(?)", req.user.org_id, data.account);
        if (!acc) {
          acc = { id: Number(run("INSERT INTO accounts (org_id, name, owner_id, created_at) VALUES (?,?,?,?)", req.user.org_id, data.account, data.ownerId, T).lastInsertRowid) };
        }
        let contactId: number | null = null;
        if (data.r.contact_name?.trim()) {
          const c = get("SELECT id FROM contacts WHERE account_id = ? AND lower(name) = lower(?)", acc.id, data.r.contact_name.trim());
          contactId = c
            ? c.id
            : Number(
                run(
                  "INSERT INTO contacts (org_id, account_id, name, title, email) VALUES (?,?,?,?,?)",
                  req.user.org_id, acc.id, data.r.contact_name.trim(), data.r.contact_title?.trim() ?? "", data.r.contact_email?.trim() ?? "",
                ).lastInsertRowid,
              );
        }
        const closed = !isOpen(data.stage!);
        const dealId = Number(
          run(
            `INSERT INTO deals (org_id, account_id, contact_id, name, amount, stage_id, owner_id, source, product_line,
               expected_close_date, created_at, stage_entered_at, next_step, forecast_category, closed_at, lost_reason)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            req.user.org_id, acc.id, contactId, data.name.slice(0, 160), data.amount, data.stage!.id, data.ownerId, data.source,
            data.r.product_line?.trim() ?? "", data.close, T, T, data.r.next_step?.trim() ?? "",
            data.stage!.is_won ? "commit" : data.stage!.is_lost ? "omitted" : "pipeline",
            closed ? data.close : null, data.stage!.is_lost ? "Not recorded" : null,
          ).lastInsertRowid,
        );
        run("INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_at, changed_by) VALUES (?,NULL,?,?,?)", dealId, data.stage!.id, T, req.user.id);
        created++;
      }
    });
    audit(req.user.org_id, req.user.id, "import", null, "deals", `${created} created, ${results.length - valid.length} skipped`);
  }
  res.json({
    dryRun,
    total: rows.length,
    valid: valid.length,
    created,
    results: results.map(({ row, errors, warnings }) => ({ row, errors, warnings })).filter((r) => r.errors.length || r.warnings.length),
  });
});

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Prefix formula-like values so spreadsheets don't execute them.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

adminRouter.get("/export/deals.csv", (req, res) => {
  const rows = loadDeals({ orgId: req.user.org_id, ownerId: canSeeAll(req.user) ? undefined : req.user.id });
  const cols = ["id", "name", "account_name", "amount", "stage_name", "owner_name", "source", "product_line", "expected_close_date", "forecast_category", "created_at", "closed_at", "lost_reason", "next_step", "risk_score", "risk_level", "priority_score"];
  const lines = [cols.join(",")];
  for (const r of rows) {
    const flat: Record<string, unknown> = { ...r, risk_score: r.risk.score, risk_level: r.risk.level, priority_score: r.priority.score };
    lines.push(cols.map((c) => csvCell(flat[c])).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="mnt-revenue-deals-${today()}.csv"`);
  res.send("\uFEFF" + lines.join("\n"));
});
