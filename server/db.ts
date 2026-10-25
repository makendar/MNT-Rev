import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const RAW_PATH = process.env.MNT_DB_PATH ?? "data/mnt-revenue.db";
const DB_PATH = RAW_PATH === ":memory:" ? RAW_PATH : resolve(RAW_PATH);

export type Row = Record<string, any>;

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (!instance) {
    if (DB_PATH !== ":memory:") mkdirSync(dirname(DB_PATH), { recursive: true });
    instance = new DatabaseSync(DB_PATH);
    instance.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    migrate(instance);
  }
  return instance;
}

export function all<T = Row>(sql: string, ...params: any[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T = Row>(sql: string, ...params: any[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: any[]) {
  return db().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function resetDatabase() {
  const d = db();
  d.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS audit_log; DROP TABLE IF EXISTS targets; DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS activities; DROP TABLE IF EXISTS deal_stage_history; DROP TABLE IF EXISTS deals;
    DROP TABLE IF EXISTS contacts; DROP TABLE IF EXISTS accounts; DROP TABLE IF EXISTS stages;
    DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS teams;
    DROP TABLE IF EXISTS organizations;
    PRAGMA foreign_keys = ON;
  `);
  migrate(d);
}

function migrate(d: DatabaseSync) {
  // Every business table carries org_id so the schema is multi-tenant ready.
  d.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      fy_start_month INTEGER NOT NULL DEFAULT 4,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      team_id INTEGER REFERENCES teams(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner','manager','rep')),
      title TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stages (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      probability REAL NOT NULL,
      is_won INTEGER NOT NULL DEFAULT 0,
      is_lost INTEGER NOT NULL DEFAULT 0,
      expected_days INTEGER NOT NULL DEFAULT 21
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      industry TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      owner_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      is_decision_maker INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0),
      stage_id INTEGER NOT NULL REFERENCES stages(id),
      owner_id INTEGER NOT NULL REFERENCES users(id),
      source TEXT NOT NULL DEFAULT '',
      product_line TEXT NOT NULL DEFAULT '',
      expected_close_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      stage_entered_at TEXT NOT NULL,
      last_activity_at TEXT,
      next_step TEXT NOT NULL DEFAULT '',
      next_step_date TEXT,
      forecast_category TEXT NOT NULL DEFAULT 'pipeline'
        CHECK (forecast_category IN ('pipeline','best_case','commit','omitted')),
      close_date_pushes INTEGER NOT NULL DEFAULT 0,
      lost_reason TEXT,
      closed_at TEXT,
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_deals_org_stage ON deals(org_id, stage_id);
    CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id);
    CREATE TABLE IF NOT EXISTS deal_stage_history (
      id INTEGER PRIMARY KEY,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      from_stage_id INTEGER REFERENCES stages(id),
      to_stage_id INTEGER NOT NULL REFERENCES stages(id),
      changed_at TEXT NOT NULL,
      changed_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_history_deal ON deal_stage_history(deal_id);
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('call','email','meeting','demo','note')),
      subject TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id);
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
      assigned_to INTEGER NOT NULL REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'follow_up',
      due_date TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to, status);
    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      user_id INTEGER REFERENCES users(id),
      period_key TEXT NOT NULL,
      amount REAL NOT NULL,
      UNIQUE (org_id, user_id, period_key)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL,
      user_id INTEGER,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function audit(orgId: number, userId: number | null, entity: string, entityId: number | null, action: string, detail = "") {
  run(
    "INSERT INTO audit_log (org_id, user_id, entity, entity_id, action, detail) VALUES (?,?,?,?,?,?)",
    orgId,
    userId,
    entity,
    entityId,
    action,
    detail,
  );
}
