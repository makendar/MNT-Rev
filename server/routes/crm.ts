import { Router, type Request } from "express";
import { today } from "../../shared/dates.ts";
import { canSeeAll } from "../auth.ts";
import { all, audit, get, run } from "../db.ts";
import { loadDeals } from "../services/deals.ts";
import { bad, forbidden, id, notFound, str } from "../validate.ts";

export const crmRouter = Router();

function ownerFilter(req: Request) {
  return canSeeAll(req.user) ? { sql: "", params: [] as any[] } : { sql: "AND d.owner_id = ?", params: [req.user.id] };
}

crmRouter.get("/accounts", (req, res) => {
  const f = ownerFilter(req);
  const rows = all(
    `SELECT a.*, u.name owner_name,
            (SELECT COUNT(*) FROM contacts c WHERE c.account_id = a.id) contacts,
            COALESCE(SUM(CASE WHEN s.is_won = 0 AND s.is_lost = 0 THEN 1 END), 0) open_deals,
            COALESCE(SUM(CASE WHEN s.is_won = 0 AND s.is_lost = 0 THEN d.amount END), 0) open_amount,
            COALESCE(SUM(CASE WHEN s.is_won = 1 THEN d.amount END), 0) won_amount,
            MAX(d.last_activity_at) last_activity
       FROM accounts a
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN deals d ON d.account_id = a.id ${f.sql}
       LEFT JOIN stages s ON s.id = d.stage_id
      WHERE a.org_id = ?
      GROUP BY a.id ORDER BY open_amount DESC, won_amount DESC`,
    ...f.params,
    req.user.org_id,
  );
  res.json(req.query.filter === "expansion" ? rows.filter((r) => r.won_amount > 0 && r.open_deals === 0) : rows);
});

crmRouter.get("/accounts/:id", (req, res) => {
  const account = get("SELECT a.*, u.name owner_name FROM accounts a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ? AND a.org_id = ?", id(req.params.id), req.user.org_id);
  if (!account) throw notFound("Account");
  const contacts = all("SELECT * FROM contacts WHERE account_id = ? ORDER BY is_decision_maker DESC, name", account.id);
  const deals = loadDeals({ orgId: req.user.org_id, ownerId: canSeeAll(req.user) ? undefined : req.user.id }, "d.account_id = ?", [account.id]);
  const activities = all(
    `SELECT a.*, u.name user_name, d.name deal_name FROM activities a JOIN users u ON u.id = a.user_id LEFT JOIN deals d ON d.id = a.deal_id
      WHERE a.account_id = ? ${canSeeAll(req.user) ? "" : "AND a.user_id = ?"} ORDER BY a.occurred_at DESC LIMIT 40`,
    account.id,
    ...(canSeeAll(req.user) ? [] : [req.user.id]),
  );
  res.json({ account, contacts, deals, activities });
});

function accountFields(b: any) {
  return {
    name: str(b.name, "Account name", { required: true, max: 160 }),
    industry: str(b.industry, "Industry", { max: 80 }),
    city: str(b.city, "City", { max: 80 }),
    size: str(b.size, "Size", { max: 40 }),
    website: str(b.website, "Website", { max: 160 }),
  };
}

crmRouter.post("/accounts", (req, res) => {
  const f = accountFields(req.body ?? {});
  if (get("SELECT id FROM accounts WHERE org_id = ? AND lower(name) = lower(?)", req.user.org_id, f.name)) throw bad("An account with this name already exists");
  const r = run(
    "INSERT INTO accounts (org_id, name, industry, city, size, website, owner_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
    req.user.org_id, f.name, f.industry, f.city, f.size, f.website, req.user.id, today(),
  );
  audit(req.user.org_id, req.user.id, "account", Number(r.lastInsertRowid), "create", f.name);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

crmRouter.patch("/accounts/:id", (req, res) => {
  const acc = get("SELECT * FROM accounts WHERE id = ? AND org_id = ?", id(req.params.id), req.user.org_id);
  if (!acc) throw notFound("Account");
  if (!canSeeAll(req.user) && acc.owner_id !== req.user.id) throw forbidden("Only the account owner or a manager can edit this account");
  const f = accountFields({ ...acc, ...req.body });
  run("UPDATE accounts SET name = ?, industry = ?, city = ?, size = ?, website = ? WHERE id = ?", f.name, f.industry, f.city, f.size, f.website, acc.id);
  audit(req.user.org_id, req.user.id, "account", acc.id, "update", f.name);
  res.json({ ok: true });
});

crmRouter.get("/contacts", (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  res.json(
    all(
      `SELECT c.*, a.name account_name FROM contacts c JOIN accounts a ON a.id = c.account_id
        WHERE c.org_id = ? ${q ? "AND (c.name LIKE ? OR c.email LIKE ? OR a.name LIKE ?)" : ""}
        ORDER BY a.name, c.is_decision_maker DESC, c.name`,
      req.user.org_id,
      ...(q ? [q, q, q] : []),
    ),
  );
});

function contactFields(b: any) {
  const email = str(b.email, "Email", { max: 160 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Email address looks invalid");
  return {
    name: str(b.name, "Contact name", { required: true, max: 120 }),
    title: str(b.title, "Title", { max: 120 }),
    email,
    phone: str(b.phone, "Phone", { max: 40 }),
    is_decision_maker: b.is_decision_maker ? 1 : 0,
  };
}

crmRouter.post("/contacts", (req, res) => {
  const b = req.body ?? {};
  const acc = get("SELECT id FROM accounts WHERE id = ? AND org_id = ?", id(b.account_id, "account"), req.user.org_id);
  if (!acc) throw bad("Unknown account");
  const f = contactFields(b);
  const r = run(
    "INSERT INTO contacts (org_id, account_id, name, title, email, phone, is_decision_maker) VALUES (?,?,?,?,?,?,?)",
    req.user.org_id, acc.id, f.name, f.title, f.email, f.phone, f.is_decision_maker,
  );
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

crmRouter.patch("/contacts/:id", (req, res) => {
  const c = get("SELECT * FROM contacts WHERE id = ? AND org_id = ?", id(req.params.id), req.user.org_id);
  if (!c) throw notFound("Contact");
  const f = contactFields({ ...c, ...req.body });
  run("UPDATE contacts SET name = ?, title = ?, email = ?, phone = ?, is_decision_maker = ? WHERE id = ?", f.name, f.title, f.email, f.phone, f.is_decision_maker, c.id);
  res.json({ ok: true });
});
