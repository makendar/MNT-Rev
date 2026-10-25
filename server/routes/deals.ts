import { Router, type Request } from "express";
import { addDays, today } from "../../shared/dates.ts";
import { inr } from "../../shared/format.ts";
import { isOpen } from "../../shared/scoring.ts";
import { LOST_REASONS, SOURCES, type Deal, type DealRow, type Stage } from "../../shared/types.ts";
import { canSeeAll } from "../auth.ts";
import { all, audit, get, run, tx } from "../db.ts";
import { getStages, loadDeals, recommendActions } from "../services/deals.ts";
import { bad, date, forbidden, id, notFound, num, oneOf, str } from "../validate.ts";

export const dealsRouter = Router();

const FORECAST = ["pipeline", "best_case", "commit", "omitted"] as const;
const ACTIVITY_TYPES = ["call", "email", "meeting", "demo", "note"] as const;
const PRIORITIES = ["low", "medium", "high"] as const;

const nowStamp = () => new Date().toISOString().slice(0, 19);

function scopeOf(req: Request) {
  return { orgId: req.user.org_id, ownerId: canSeeAll(req.user) ? undefined : req.user.id };
}

function rawDeal(req: Request, dealId: number): Deal {
  const deal = get<Deal>("SELECT * FROM deals WHERE id = ? AND org_id = ?", dealId, req.user.org_id);
  if (!deal) throw notFound("Deal");
  if (!canSeeAll(req.user) && deal.owner_id !== req.user.id) throw forbidden("This deal belongs to another salesperson");
  return deal;
}

function stageFor(req: Request, stageId: number): Stage {
  const s = getStages(req.user.org_id).find((x) => x.id === stageId);
  if (!s) throw bad("Unknown stage");
  return s;
}

function applyStageChange(req: Request, deal: Deal, stage: Stage, lostReason?: string) {
  if (stage.id === deal.stage_id) return;
  if (stage.is_lost && !lostReason) throw bad("A lost reason is required when closing a deal as lost");
  const stamp = nowStamp();
  const closed = !isOpen(stage);
  run(
    `UPDATE deals SET stage_id = ?, stage_entered_at = ?, closed_at = ?, lost_reason = ?, forecast_category = ? WHERE id = ?`,
    stage.id,
    stamp,
    closed ? today() : null,
    stage.is_lost ? lostReason : null,
    stage.is_won ? "commit" : stage.is_lost ? "omitted" : deal.forecast_category === "omitted" ? "pipeline" : deal.forecast_category,
    deal.id,
  );
  run("INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_at, changed_by) VALUES (?,?,?,?,?)", deal.id, deal.stage_id, stage.id, stamp, req.user.id);
  audit(req.user.org_id, req.user.id, "deal", deal.id, "stage_change", `→ ${stage.name}${lostReason ? ` (${lostReason})` : ""}`);
}

dealsRouter.get("/deals", (req, res) => {
  const scope = scopeOf(req);
  const where: string[] = [];
  const params: any[] = [];
  const q = req.query;
  if (q.owner && canSeeAll(req.user)) {
    where.push("d.owner_id = ?");
    params.push(id(q.owner, "owner"));
  }
  if (q.stage) {
    where.push("d.stage_id = ?");
    params.push(id(q.stage, "stage"));
  }
  if (q.source) {
    where.push("d.source = ?");
    params.push(String(q.source));
  }
  if (q.status === "open") where.push("s.is_won = 0 AND s.is_lost = 0");
  if (q.status === "won") where.push("s.is_won = 1");
  if (q.status === "lost") where.push("s.is_lost = 1");
  if (q.closeFrom) {
    where.push("d.expected_close_date >= ?");
    params.push(date(q.closeFrom, "closeFrom"));
  }
  if (q.closeTo) {
    where.push("d.expected_close_date <= ?");
    params.push(date(q.closeTo, "closeTo"));
  }
  if (q.account) {
    where.push("d.account_id = ?");
    params.push(id(q.account, "account"));
  }
  if (q.q) {
    where.push("(d.name LIKE ? OR a.name LIKE ?)");
    params.push(`%${q.q}%`, `%${q.q}%`);
  }
  let rows = loadDeals(scope, where.join(" AND "), params);
  if (q.risk) rows = rows.filter((r) => r.risk.level === q.risk);
  if (q.flag) rows = rows.filter((r) => r.risk.factors.some((f) => f.code === q.flag));
  res.json(rows);
});

dealsRouter.get("/deals/:id", (req, res) => {
  const deal = rawDeal(req, id(req.params.id));
  const [row] = loadDeals({ orgId: req.user.org_id }, "d.id = ?", [deal.id]);
  const stage = stageFor(req, deal.stage_id);
  const account = get("SELECT * FROM accounts WHERE id = ?", deal.account_id);
  const contacts = all("SELECT * FROM contacts WHERE account_id = ? ORDER BY is_decision_maker DESC, name", deal.account_id);
  const activities = all(
    "SELECT a.*, u.name user_name FROM activities a JOIN users u ON u.id = a.user_id WHERE a.deal_id = ? ORDER BY a.occurred_at DESC",
    deal.id,
  );
  const tasks = all(
    "SELECT t.*, u.name assignee_name FROM tasks t JOIN users u ON u.id = t.assigned_to WHERE t.deal_id = ? ORDER BY t.status, t.due_date",
    deal.id,
  );
  const history = all(
    `SELECT h.changed_at, fs.name from_stage, ts.name to_stage, u.name changed_by
       FROM deal_stage_history h LEFT JOIN stages fs ON fs.id = h.from_stage_id JOIN stages ts ON ts.id = h.to_stage_id
       LEFT JOIN users u ON u.id = h.changed_by WHERE h.deal_id = ? ORDER BY h.changed_at DESC`,
    deal.id,
  );
  res.json({
    deal: row,
    stage,
    account,
    contacts,
    activities,
    tasks,
    history,
    recommendations: recommendActions(row, stage),
    emailDraft: isOpen(stage) ? draftEmail(row, req.user.name, req.user.title, activities[0] as any) : null,
  });
});

function draftEmail(deal: DealRow, senderName: string, senderTitle: string, last?: { subject: string; occurred_at: string }) {
  const first = deal.contact_name?.split(" ")[0] ?? "there";
  const context = last ? `Thank you for your time during our recent ${last.subject.toLowerCase()}.` : "I hope you're doing well.";
  const step = deal.next_step ? `As a next step, I'd suggest we ${deal.next_step.charAt(0).toLowerCase()}${deal.next_step.slice(1)}.` : "Could we set up a short call to agree the next steps?";
  return {
    subject: `${deal.product_line}: next steps for ${deal.account_name}`,
    body: `Hi ${first},\n\n${context} I wanted to follow up on the ${deal.product_line.toLowerCase()} initiative we've been discussing.\n\n${step} Would any time this week or early next week work for you?\n\nIf there are questions from your team that I can help answer beforehand, please let me know.\n\nBest regards,\n${senderName}\n${senderTitle}`,
    note: "Template-generated from deal fields. Review and personalise before sending.",
  };
}

function resolveAccount(req: Request, body: any): number {
  if (body.account_id) {
    const acc = get("SELECT id FROM accounts WHERE id = ? AND org_id = ?", id(body.account_id, "account"), req.user.org_id);
    if (!acc) throw bad("Unknown account");
    return acc.id;
  }
  const name = str(body.account_name, "Account", { required: true, max: 160 });
  const existing = get("SELECT id FROM accounts WHERE org_id = ? AND lower(name) = lower(?)", req.user.org_id, name);
  if (existing) return existing.id;
  return Number(
    run("INSERT INTO accounts (org_id, name, owner_id, created_at) VALUES (?,?,?,?)", req.user.org_id, name, req.user.id, today()).lastInsertRowid,
  );
}

function resolveOwner(req: Request, v: unknown): number {
  if (!v || !canSeeAll(req.user)) return req.user.id;
  const u = get("SELECT id FROM users WHERE id = ? AND org_id = ? AND active = 1", id(v, "owner"), req.user.org_id);
  if (!u) throw bad("Unknown owner");
  return u.id;
}

function validContact(req: Request, accountId: number, v: unknown): number | null {
  if (!v) return null;
  const c = get("SELECT id FROM contacts WHERE id = ? AND account_id = ? AND org_id = ?", id(v, "contact"), accountId, req.user.org_id);
  if (!c) throw bad("Contact does not belong to this account");
  return c.id;
}

dealsRouter.post("/deals", (req, res) => {
  const b = req.body ?? {};
  const stages = getStages(req.user.org_id).filter(isOpen);
  const stage = b.stage_id ? stages.find((s) => s.id === Number(b.stage_id)) : stages[0];
  if (!stage) throw bad("New deals must start in an open stage");
  const newId = tx(() => {
    const accountId = resolveAccount(req, b);
    const stamp = nowStamp();
    const dealId = Number(
      run(
        `INSERT INTO deals (org_id, account_id, contact_id, name, amount, stage_id, owner_id, source, product_line,
           expected_close_date, created_at, stage_entered_at, last_activity_at, next_step, next_step_date, forecast_category, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)`,
        req.user.org_id,
        accountId,
        validContact(req, accountId, b.contact_id),
        str(b.name, "Deal name", { required: true, max: 160 }),
        num(b.amount, "Amount", { min: 0, max: 1e11, required: true }),
        stage.id,
        resolveOwner(req, b.owner_id),
        b.source ? oneOf(b.source, "Source", SOURCES) : "",
        str(b.product_line, "Product line", { max: 80 }),
        date(b.expected_close_date, "Expected close date", true),
        today(),
        stamp,
        str(b.next_step, "Next step", { max: 200 }),
        date(b.next_step_date, "Next step date"),
        oneOf(b.forecast_category, "Forecast category", FORECAST, "pipeline"),
        str(b.notes, "Notes", { max: 4000 }),
      ).lastInsertRowid,
    );
    run("INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_at, changed_by) VALUES (?,NULL,?,?,?)", dealId, stage.id, stamp, req.user.id);
    audit(req.user.org_id, req.user.id, "deal", dealId, "create", `${inr(Number(b.amount))}`);
    return dealId;
  });
  res.status(201).json({ id: newId });
});

dealsRouter.patch("/deals/:id", (req, res) => {
  const deal = rawDeal(req, id(req.params.id));
  const b = req.body ?? {};
  tx(() => {
    const sets: string[] = [];
    const params: any[] = [];
    const set = (col: string, v: any) => {
      sets.push(`${col} = ?`);
      params.push(v);
    };
    if ("name" in b) set("name", str(b.name, "Deal name", { required: true, max: 160 }));
    if ("amount" in b) set("amount", num(b.amount, "Amount", { min: 0, max: 1e11, required: true }));
    if ("source" in b) set("source", b.source ? oneOf(b.source, "Source", SOURCES) : "");
    if ("product_line" in b) set("product_line", str(b.product_line, "Product line", { max: 80 }));
    if ("next_step" in b) set("next_step", str(b.next_step, "Next step", { max: 200 }));
    if ("next_step_date" in b) set("next_step_date", date(b.next_step_date, "Next step date"));
    if ("notes" in b) set("notes", str(b.notes, "Notes", { max: 4000 }));
    if ("forecast_category" in b) set("forecast_category", oneOf(b.forecast_category, "Forecast category", FORECAST));
    if ("owner_id" in b) {
      if (!canSeeAll(req.user)) throw forbidden("Only managers can reassign deals");
      set("owner_id", resolveOwner(req, b.owner_id));
    }
    if ("contact_id" in b) set("contact_id", validContact(req, deal.account_id, b.contact_id));
    if ("expected_close_date" in b) {
      const d = date(b.expected_close_date, "Expected close date", true)!;
      set("expected_close_date", d);
      if (d > deal.expected_close_date) set("close_date_pushes", deal.close_date_pushes + 1);
    }
    if (sets.length) {
      run(`UPDATE deals SET ${sets.join(", ")} WHERE id = ?`, ...params, deal.id);
      audit(req.user.org_id, req.user.id, "deal", deal.id, "update", Object.keys(b).filter((k) => k !== "stage_id" && k !== "lost_reason").join(", "));
    }
    if ("stage_id" in b) {
      const lr = b.lost_reason ? oneOf(b.lost_reason, "Lost reason", LOST_REASONS) : undefined;
      applyStageChange(req, deal, stageFor(req, id(b.stage_id, "stage")), lr);
    }
  });
  res.json({ ok: true });
});

dealsRouter.delete("/deals/:id", (req, res) => {
  if (!canSeeAll(req.user)) throw forbidden("Only managers can delete deals");
  const deal = rawDeal(req, id(req.params.id));
  run("DELETE FROM deals WHERE id = ?", deal.id);
  audit(req.user.org_id, req.user.id, "deal", deal.id, "delete", deal.name);
  res.json({ ok: true });
});

// ---------- Activities ----------

dealsRouter.post("/activities", (req, res) => {
  const b = req.body ?? {};
  let dealId: number | null = null;
  let accountId: number | null = b.account_id ? id(b.account_id, "account") : null;
  if (b.deal_id) {
    const deal = rawDeal(req, id(b.deal_id, "deal"));
    dealId = deal.id;
    accountId = deal.account_id;
  }
  if (!dealId && !accountId) throw bad("An activity must be linked to a deal or an account");
  if (accountId && !get("SELECT id FROM accounts WHERE id = ? AND org_id = ?", accountId, req.user.org_id)) throw bad("Unknown account");
  const occurred = b.occurred_at ? `${date(b.occurred_at, "Date")}T${new Date().toTimeString().slice(0, 8)}` : nowStamp();
  const result = tx(() => {
    const actId = Number(
      run(
        "INSERT INTO activities (org_id, deal_id, account_id, user_id, type, subject, notes, outcome, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
        req.user.org_id,
        dealId,
        accountId,
        req.user.id,
        oneOf(b.type, "Type", ACTIVITY_TYPES),
        str(b.subject, "Subject", { required: true, max: 200 }),
        str(b.notes, "Notes", { max: 4000 }),
        str(b.outcome, "Outcome", { max: 80 }),
        occurred,
      ).lastInsertRowid,
    );
    if (dealId) run("UPDATE deals SET last_activity_at = MAX(COALESCE(last_activity_at, ''), ?) WHERE id = ?", occurred, dealId);
    let taskId: number | null = null;
    if (b.follow_up?.title) {
      taskId = Number(
        run(
          "INSERT INTO tasks (org_id, deal_id, assigned_to, created_by, title, type, due_date, priority) VALUES (?,?,?,?,?,?,?,?)",
          req.user.org_id,
          dealId,
          req.user.id,
          req.user.id,
          str(b.follow_up.title, "Follow-up title", { required: true, max: 200 }),
          "follow_up",
          date(b.follow_up.due_date, "Follow-up date", true),
          oneOf(b.follow_up.priority, "Priority", PRIORITIES, "medium"),
        ).lastInsertRowid,
      );
    }
    return { id: actId, taskId };
  });
  res.status(201).json(result);
});

dealsRouter.get("/activities", (req, res) => {
  const scope = scopeOf(req);
  const rows = all(
    `SELECT a.*, u.name user_name, d.name deal_name, ac.name account_name FROM activities a
       JOIN users u ON u.id = a.user_id LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN accounts ac ON ac.id = a.account_id
      WHERE a.org_id = ? ${scope.ownerId ? "AND a.user_id = ?" : ""} ${req.query.account ? "AND a.account_id = ?" : ""}
      ORDER BY a.occurred_at DESC LIMIT 100`,
    scope.orgId,
    ...(scope.ownerId ? [scope.ownerId] : []),
    ...(req.query.account ? [id(req.query.account, "account")] : []),
  );
  res.json(rows);
});

// ---------- Tasks / follow-ups ----------

dealsRouter.get("/tasks", (req, res) => {
  const T = today();
  const where = ["t.org_id = ?"];
  const params: any[] = [req.user.org_id];
  const assignee = canSeeAll(req.user) ? (req.query.assignee ? id(req.query.assignee, "assignee") : null) : req.user.id;
  if (assignee) {
    where.push("t.assigned_to = ?");
    params.push(assignee);
  }
  switch (req.query.view) {
    case "overdue":
      where.push("t.status = 'open' AND t.due_date < ?");
      params.push(T);
      break;
    case "today":
      where.push("t.status = 'open' AND t.due_date = ?");
      params.push(T);
      break;
    case "upcoming":
      where.push("t.status = 'open' AND t.due_date > ?");
      params.push(T);
      break;
    case "done":
      where.push("t.status = 'done' AND t.completed_at >= ?");
      params.push(addDays(T, -14));
      break;
    default:
      where.push("t.status = 'open'");
  }
  const rows = all(
    `SELECT t.*, d.name deal_name, d.amount deal_amount, a.name account_name, u.name assignee_name
       FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id LEFT JOIN accounts a ON a.id = d.account_id
       JOIN users u ON u.id = t.assigned_to
      WHERE ${where.join(" AND ")}
      ORDER BY ${req.query.view === "done" ? "t.completed_at DESC" : "t.due_date, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END"}
      LIMIT 300`,
    ...params,
  );
  const counts = get(
    `SELECT SUM(CASE WHEN status='open' AND due_date < ? THEN 1 ELSE 0 END) overdue,
            SUM(CASE WHEN status='open' AND due_date = ? THEN 1 ELSE 0 END) today,
            SUM(CASE WHEN status='open' AND due_date > ? THEN 1 ELSE 0 END) upcoming,
            SUM(CASE WHEN status='done' AND completed_at >= ? THEN 1 ELSE 0 END) done
       FROM tasks t WHERE org_id = ? ${assignee ? "AND assigned_to = ?" : ""}`,
    T, T, T, addDays(T, -14), req.user.org_id, ...(assignee ? [assignee] : []),
  );
  res.json({ tasks: rows, counts });
});

function rawTask(req: Request, taskId: number) {
  const t = get("SELECT * FROM tasks WHERE id = ? AND org_id = ?", taskId, req.user.org_id);
  if (!t) throw notFound("Follow-up");
  if (!canSeeAll(req.user) && t.assigned_to !== req.user.id) throw forbidden();
  return t;
}

dealsRouter.post("/tasks", (req, res) => {
  const b = req.body ?? {};
  const dealId = b.deal_id ? rawDeal(req, id(b.deal_id, "deal")).id : null;
  const assignee = canSeeAll(req.user) && b.assigned_to ? id(b.assigned_to, "assignee") : req.user.id;
  if (!get("SELECT id FROM users WHERE id = ? AND org_id = ?", assignee, req.user.org_id)) throw bad("Unknown assignee");
  const r = run(
    "INSERT INTO tasks (org_id, deal_id, assigned_to, created_by, title, type, due_date, priority) VALUES (?,?,?,?,?,?,?,?)",
    req.user.org_id,
    dealId,
    assignee,
    req.user.id,
    str(b.title, "Title", { required: true, max: 200 }),
    str(b.type, "Type", { max: 30 }) || "follow_up",
    date(b.due_date, "Due date", true),
    oneOf(b.priority, "Priority", PRIORITIES, "medium"),
  );
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

dealsRouter.patch("/tasks/:id", (req, res) => {
  const t = rawTask(req, id(req.params.id));
  const b = req.body ?? {};
  if ("status" in b) {
    const status = oneOf(b.status, "Status", ["open", "done"] as const);
    run("UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?", status, status === "done" ? nowStamp() : null, t.id);
  }
  if ("due_date" in b) run("UPDATE tasks SET due_date = ? WHERE id = ?", date(b.due_date, "Due date", true), t.id);
  if ("title" in b) run("UPDATE tasks SET title = ? WHERE id = ?", str(b.title, "Title", { required: true, max: 200 }), t.id);
  if ("priority" in b) run("UPDATE tasks SET priority = ? WHERE id = ?", oneOf(b.priority, "Priority", PRIORITIES), t.id);
  if ("assigned_to" in b) {
    if (!canSeeAll(req.user)) throw forbidden("Only managers can reassign follow-ups");
    const a = id(b.assigned_to, "assignee");
    if (!get("SELECT id FROM users WHERE id = ? AND org_id = ?", a, req.user.org_id)) throw bad("Unknown assignee");
    run("UPDATE tasks SET assigned_to = ? WHERE id = ?", a, t.id);
  }
  res.json({ ok: true });
});

dealsRouter.delete("/tasks/:id", (req, res) => {
  const t = rawTask(req, id(req.params.id));
  run("DELETE FROM tasks WHERE id = ?", t.id);
  res.json({ ok: true });
});
