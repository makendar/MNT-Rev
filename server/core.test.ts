import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, fiscalQuarter, fiscalYear } from "../shared/dates.ts";
import { inr, inrCompact } from "../shared/format.ts";
import { scorePriority, scoreRisk, type ScoringContext } from "../shared/scoring.ts";
import type { Deal, Stage } from "../shared/types.ts";

test("Indian fiscal quarters run April–March", () => {
  assert.equal(fiscalQuarter("2026-10-25").key, "FY27-Q3");
  assert.equal(fiscalQuarter("2026-10-25").start, "2026-10-01");
  assert.equal(fiscalQuarter("2026-10-25").end, "2026-12-31");
  assert.equal(fiscalQuarter("2027-01-05").key, "FY27-Q4");
  assert.equal(fiscalQuarter("2027-03-31").end, "2027-03-31");
  assert.equal(fiscalQuarter("2027-04-01").key, "FY28-Q1");
  assert.equal(fiscalYear("2026-06-15").start, "2026-04-01");
  assert.equal(fiscalYear("2026-06-15").end, "2027-03-31");
});

test("INR formatting uses lakh and crore", () => {
  assert.equal(inrCompact(1_250_000), "₹12.5 L");
  assert.equal(inrCompact(12_500_000), "₹1.25 Cr");
  assert.equal(inrCompact(45_000), "₹45 K");
  assert.equal(inr(1_250_000), "₹12,50,000");
});

const T = "2026-10-25";
const stage: Stage = { id: 4, name: "Proposal", position: 4, probability: 0.55, is_won: 0, is_lost: 0, expected_days: 21 };
const baseDeal: Deal = {
  id: 1, org_id: 1, account_id: 1, contact_id: 1, name: "Test", amount: 5_000_000, stage_id: 4, owner_id: 1,
  source: "Referral", product_line: "x", expected_close_date: addDays(T, 20), created_at: addDays(T, -40),
  stage_entered_at: addDays(T, -10), last_activity_at: addDays(T, -2), next_step: "Send proposal",
  next_step_date: addDays(T, 3), forecast_category: "best_case", close_date_pushes: 0, lost_reason: null, closed_at: null, notes: "",
};
const ctx: ScoringContext = { today: T, stage, openStageCount: 5, overdueTasks: 0, openTasks: 1, hasDecisionMaker: true, activitiesLast30: 5, medianOpenAmount: 2_500_000 };

test("a healthy deal has no risk factors", () => {
  const r = scoreRisk(baseDeal, ctx);
  assert.equal(r.score, 0);
  assert.equal(r.level, "low");
});

test("risk factors are additive and explained", () => {
  const r = scoreRisk(
    { ...baseDeal, last_activity_at: addDays(T, -45), expected_close_date: addDays(T, -5), next_step: "", close_date_pushes: 3 },
    { ...ctx, overdueTasks: 2, hasDecisionMaker: false },
  );
  const codes = r.factors.map((f) => f.code).sort();
  assert.deepEqual(codes, ["idle", "no_decision_maker", "no_next_step", "overdue_close", "overdue_tasks", "slipping"]);
  assert.equal(r.score, Math.min(100, r.factors.reduce((s, f) => s + f.points, 0)));
  assert.equal(r.level, "high");
  for (const f of r.factors) assert.ok(f.detail.length > 0);
});

test("closed deals are never scored", () => {
  const won = { ...stage, is_won: 1, name: "Closed Won" };
  assert.equal(scoreRisk(baseDeal, { ...ctx, stage: won }).score, 0);
  assert.equal(scorePriority(baseDeal, { ...ctx, stage: won }, { score: 0, level: "low", factors: [] }).score, 0);
});

test("priority favours large, late-stage, near-close deals", () => {
  const risk = scoreRisk(baseDeal, ctx);
  const big = scorePriority(baseDeal, ctx, risk).score;
  const small = scorePriority({ ...baseDeal, amount: 300_000, expected_close_date: addDays(T, 150) }, { ...ctx, stage: { ...stage, position: 1 } }, risk).score;
  assert.ok(big > small, `${big} should exceed ${small}`);
});
