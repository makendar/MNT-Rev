import { addDays, today } from "../../shared/dates.ts";
import { isOpen, median, scorePriority, scoreRisk, type ScoringContext } from "../../shared/scoring.ts";
import type { Deal, DealRow, Stage } from "../../shared/types.ts";
import { all, get } from "../db.ts";

export interface DealScope {
  orgId: number;
  ownerId?: number;
}

export function getStages(orgId: number): Stage[] {
  return all<Stage>("SELECT id, name, position, probability, is_won, is_lost, expected_days FROM stages WHERE org_id = ? ORDER BY position", orgId);
}

export function getOrg(orgId: number) {
  return get<{ id: number; name: string; currency: string; fy_start_month: number }>("SELECT * FROM organizations WHERE id = ?", orgId)!;
}

/** Loads deals with joined names and computed risk & priority scores. */
export function loadDeals(scope: DealScope, extraWhere = "", extraParams: any[] = []): DealRow[] {
  const T = today();
  const stages = getStages(scope.orgId);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const openStageCount = stages.filter(isOpen).length;

  const where = ["d.org_id = ?"];
  const params: any[] = [scope.orgId];
  if (scope.ownerId) {
    where.push("d.owner_id = ?");
    params.push(scope.ownerId);
  }
  if (extraWhere) where.push(extraWhere);
  params.push(...extraParams);

  const deals = all<Deal & { account_name: string; owner_name: string; stage_name: string; contact_name: string | null; contact_dm: number | null }>(
    `SELECT d.*, a.name account_name, u.name owner_name, s.name stage_name, c.name contact_name, c.is_decision_maker contact_dm
       FROM deals d
       JOIN accounts a ON a.id = d.account_id
       JOIN users u ON u.id = d.owner_id
       JOIN stages s ON s.id = d.stage_id
       LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE ${where.join(" AND ")}
      ORDER BY d.expected_close_date`,
    ...params,
  );
  if (!deals.length) return [];

  const taskStats = new Map(
    all<{ deal_id: number; open: number; overdue: number }>(
      `SELECT deal_id, COUNT(*) open, SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) overdue
         FROM tasks WHERE org_id = ? AND status = 'open' AND deal_id IS NOT NULL GROUP BY deal_id`,
      T,
      scope.orgId,
    ).map((r) => [r.deal_id, r]),
  );
  const recentActs = new Map(
    all<{ deal_id: number; n: number }>(
      "SELECT deal_id, COUNT(*) n FROM activities WHERE org_id = ? AND deal_id IS NOT NULL AND occurred_at >= ? GROUP BY deal_id",
      scope.orgId,
      addDays(T, -30),
    ).map((r) => [r.deal_id, r.n]),
  );

  // Normalise against the whole org so a rep's scores match what their manager sees.
  const orgMedian = median(
    all<{ amount: number }>(
      "SELECT amount FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.org_id = ? AND s.is_won = 0 AND s.is_lost = 0",
      scope.orgId,
    ).map((r) => r.amount),
  );

  return deals.map(({ contact_dm, ...d }) => {
    const stage = stageById.get(d.stage_id)!;
    const ts = taskStats.get(d.id);
    const ctx: ScoringContext = {
      today: T,
      stage,
      openStageCount,
      overdueTasks: ts?.overdue ?? 0,
      openTasks: ts?.open ?? 0,
      hasDecisionMaker: !!contact_dm,
      activitiesLast30: recentActs.get(d.id) ?? 0,
      medianOpenAmount: orgMedian,
    };
    const risk = scoreRisk(d, ctx);
    return { ...d, risk, priority: scorePriority(d, ctx, risk) };
  });
}

export function openDeals(rows: DealRow[], stages: Stage[]): DealRow[] {
  const open = new Set(stages.filter(isOpen).map((s) => s.id));
  return rows.filter((r) => open.has(r.stage_id));
}

/** Rule-based next-best-actions for a single deal, derived from its risk factors and state. */
export function recommendActions(deal: DealRow, stage: Stage): string[] {
  if (!isOpen(stage)) return [];
  const out: string[] = [];
  const codes = new Set(deal.risk.factors.map((f) => f.code));
  if (codes.has("idle")) out.push(`Re-engage ${deal.contact_name ?? "the buyer"} — call rather than email; ask what has changed since your last conversation.`);
  if (codes.has("overdue_close")) out.push("Agree a realistic close date with the buyer and update it, or move the deal to Closed Lost if there is no active intent.");
  if (codes.has("early_stage_near_close")) out.push("The close date doesn't match the stage. Either qualify fast this week or push the close date to reflect reality.");
  if (codes.has("stalled") || codes.has("slow_stage")) out.push(`Identify the blocker keeping this in ${stage.name}. Propose a specific next meeting with a decision on the agenda.`);
  if (codes.has("no_next_step")) out.push("Record a concrete next step with a date — deals without one rarely progress.");
  if (codes.has("next_step_lapsed")) out.push("The agreed next step has lapsed. Complete it or reset it with the buyer today.");
  if (codes.has("overdue_tasks")) out.push("Clear overdue follow-ups on this deal before taking new meetings.");
  if (codes.has("no_decision_maker")) out.push("Ask your champion to introduce the economic buyer (CFO / MD) before sending final commercials.");
  if (codes.has("slipping")) out.push("This deal keeps slipping. Get a mutual action plan with dated milestones signed off by the buyer.");
  if (!out.length) {
    if (stage.position >= 4) out.push("Deal is healthy. Confirm procurement steps and paperwork timelines to protect the close date.");
    else out.push("Deal is on track. Keep momentum by booking the next stage meeting before ending each call.");
  }
  return out;
}
