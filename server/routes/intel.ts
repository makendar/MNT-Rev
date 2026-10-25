import { Router, type Request } from "express";
import { fiscalQuarter, today } from "../../shared/dates.ts";
import { rephrase, aiStatus } from "../ai.ts";
import { canSeeAll } from "../auth.ts";
import { get } from "../db.ts";
import { getOrg } from "../services/deals.ts";
import { composeBriefing, generateInsights } from "../services/insights.ts";
import { analytics, dashboard, forecast } from "../services/metrics.ts";
import { date, id } from "../validate.ts";

export const intelRouter = Router();

/** Managers may narrow to one rep via ?owner=; reps are always scoped to themselves. */
function scope(req: Request) {
  if (!canSeeAll(req.user)) return { orgId: req.user.org_id, ownerId: req.user.id };
  if (req.query.owner) {
    const ownerId = id(req.query.owner, "owner");
    if (get("SELECT id FROM users WHERE id = ? AND org_id = ?", ownerId, req.user.org_id)) return { orgId: req.user.org_id, ownerId };
  }
  return { orgId: req.user.org_id };
}

intelRouter.get("/dashboard", (req, res) => res.json(dashboard(scope(req))));

intelRouter.get("/analytics", (req, res) =>
  res.json(analytics(scope(req), date(req.query.from, "from") ?? undefined, date(req.query.to, "to") ?? undefined)),
);

intelRouter.get("/forecast", (req, res) => res.json(forecast(scope(req), req.query.period ? String(req.query.period) : undefined)));

intelRouter.get("/insights", async (req, res) => {
  const s = scope(req);
  const insights = generateInsights(s, canSeeAll(req.user) && !s.ownerId);
  const period = fiscalQuarter(today(), getOrg(req.user.org_id).fy_start_month);
  const base = composeBriefing(insights, req.user.name, period.label);
  const briefing = await rephrase(base, "Rewrite this sales briefing as a concise, friendly paragraph for a busy sales leader in India.");
  res.json({ insights, briefing: briefing.text, briefingEngine: briefing.engine, ai: aiStatus(), generatedAt: new Date().toISOString() });
});
