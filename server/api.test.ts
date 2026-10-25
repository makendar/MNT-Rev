import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

process.env.MNT_DB_PATH = ":memory:";
const { seed } = await import("./seed.ts");
const { createApp } = await import("./app.ts");
const { all, get } = await import("./db.ts");
const { fiscalQuarter, today } = await import("../shared/dates.ts");

let base = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

before(() => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

async function login(email: string, password = "demo1234") {
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
}

test("rejects bad credentials and unauthenticated requests", async () => {
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "vikram@sahyadritech.in", password: "wrong" }) });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${base}/deals`)).status, 401);
});

test("reps only see and edit their own deals", async () => {
  const rep = await login("arjun@sahyadritech.in");
  const me = (await rep("GET", "/auth/me")).body;
  const deals = (await rep("GET", "/deals")).body;
  assert.ok(deals.length > 0);
  assert.ok(deals.every((d: any) => d.owner_id === me.id));
  const other = get<{ id: number }>("SELECT id FROM deals WHERE owner_id != ? LIMIT 1", me.id)!;
  assert.equal((await rep("GET", `/deals/${other.id}`)).status, 403);
  assert.equal((await rep("PATCH", `/deals/${other.id}`, { amount: 1 })).status, 403);
  assert.equal((await rep("PUT", "/targets", { period_key: "FY27-Q3", amount: 1 })).status, 403);
});

test("deal lifecycle: create, advance, require lost reason, log activity", async () => {
  const mgr = await login("vikram@sahyadritech.in");
  const meta = (await mgr("GET", "/meta")).body;
  const created = await mgr("POST", "/deals", { name: "Test deal", account_name: "Brand New Co", amount: "1250000", expected_close_date: "2026-12-15" });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const proposal = meta.stages.find((s: any) => s.name === "Proposal");
  assert.equal((await mgr("PATCH", `/deals/${id}`, { stage_id: proposal.id })).status, 200);
  const lost = meta.stages.find((s: any) => s.is_lost);
  assert.equal((await mgr("PATCH", `/deals/${id}`, { stage_id: lost.id })).status, 400);
  assert.equal((await mgr("PATCH", `/deals/${id}`, { stage_id: lost.id, lost_reason: "Price" })).status, 200);

  const detail = (await mgr("GET", `/deals/${id}`)).body;
  assert.equal(detail.deal.lost_reason, "Price");
  assert.equal(detail.history.length, 3);

  const act = await mgr("POST", "/activities", { deal_id: id, type: "call", subject: "Check-in", follow_up: { title: "Call back", due_date: "2026-11-01" } });
  assert.equal(act.status, 201);
  assert.ok(act.body.taskId);
  assert.ok(get("SELECT last_activity_at FROM deals WHERE id = ?", id)!.last_activity_at);

  assert.equal((await mgr("POST", "/deals", { name: "x", account_name: "y", amount: "-5", expected_close_date: "2026-12-15" })).status, 400);
  assert.equal((await mgr("POST", "/deals", { name: "x", account_name: "y", amount: "5", expected_close_date: "15/12/2026" })).status, 400);
});

test("pushing the close date out is counted", async () => {
  const mgr = await login("vikram@sahyadritech.in");
  const d = get<{ id: number; expected_close_date: string; close_date_pushes: number }>(
    "SELECT d.id, d.expected_close_date, d.close_date_pushes FROM deals d JOIN stages s ON s.id = d.stage_id WHERE s.is_won = 0 AND s.is_lost = 0 LIMIT 1",
  )!;
  await mgr("PATCH", `/deals/${d.id}`, { expected_close_date: "2030-01-01" });
  assert.equal(get("SELECT close_date_pushes n FROM deals WHERE id = ?", d.id)!.n, d.close_date_pushes + 1);
});

test("CSV import understands Indian amounts and dates, and dry-run writes nothing", async () => {
  const mgr = await login("vikram@sahyadritech.in");
  const before = get("SELECT COUNT(*) n FROM deals")!.n;
  const rows = [
    { account_name: "Imported One", amount: "12.5 L", expected_close_date: "15/01/2027", stage: "Discovery", owner_email: "priya@sahyadritech.in" },
    { account_name: "Imported Two", amount: "1.2 Cr", expected_close_date: "2027-02-20" },
    { account_name: "Imported Three", amount: "12,50,000", expected_close_date: "31-12-2026", stage: "Mystery" },
    { account_name: "", amount: "abc", expected_close_date: "soon" },
  ];
  const dry = (await mgr("POST", "/import/deals", { rows, dryRun: true })).body;
  assert.equal(dry.valid, 3);
  assert.equal(get("SELECT COUNT(*) n FROM deals")!.n, before);
  assert.equal(dry.results.find((r: any) => r.row === 4).errors.length, 3);
  assert.ok(dry.results.find((r: any) => r.row === 3).warnings[0].includes("Mystery"));

  const real = (await mgr("POST", "/import/deals", { rows })).body;
  assert.equal(real.created, 3);
  const imported = all<{ amount: number; expected_close_date: string }>("SELECT d.amount, d.expected_close_date FROM deals d JOIN accounts a ON a.id = d.account_id WHERE a.name LIKE 'Imported%' ORDER BY a.name");
  assert.deepEqual(
    imported.map((r) => [r.amount, r.expected_close_date]),
    [
      [1_250_000, "2027-01-15"],
      [1_250_000, "2026-12-31"],
      [12_000_000, "2027-02-20"],
    ],
  );
});

test("dashboard totals match the underlying records", async () => {
  const owner = await login("ananya@sahyadritech.in");
  const dash = (await owner("GET", "/dashboard")).body;
  const q = fiscalQuarter(today());
  const won = get<{ v: number }>(
    "SELECT COALESCE(SUM(d.amount),0) v FROM deals d JOIN stages s ON s.id = d.stage_id WHERE s.is_won = 1 AND d.closed_at BETWEEN ? AND ?",
    q.start,
    q.end,
  )!.v;
  const open = get<{ v: number }>("SELECT COALESCE(SUM(d.amount),0) v FROM deals d JOIN stages s ON s.id = d.stage_id WHERE s.is_won = 0 AND s.is_lost = 0")!.v;
  assert.equal(dash.kpis.wonAmount, won);
  assert.equal(dash.kpis.openAmount, open);
  const insights = (await owner("GET", "/insights")).body;
  assert.ok(insights.insights.length > 0);
  assert.equal(insights.ai.engine, "rules");
});

test("CSV export neutralises spreadsheet formulas", async () => {
  const mgr = await login("vikram@sahyadritech.in");
  await mgr("POST", "/deals", { name: "=HYPERLINK(\"x\")", account_name: "Formula Co", amount: "100", expected_close_date: "2026-12-15" });
  const res = await fetch(`${base}/export/deals.csv`, { headers: { cookie: (await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "vikram@sahyadritech.in", password: "demo1234" }) })).headers.get("set-cookie")!.split(";")[0] } });
  const text = await res.text();
  assert.ok(text.includes(`"'=HYPERLINK(""x"")"`));
});
