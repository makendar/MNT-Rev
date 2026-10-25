import { daysBetween } from "./dates.ts";
import type { Deal, PriorityResult, RiskFactor, RiskResult, Stage } from "./types.ts";

/**
 * Deterministic, explainable deal scoring. Every point awarded is traceable to a
 * named factor so users can see exactly why a deal is flagged. No ML, no LLM.
 */

export interface ScoringContext {
  today: string;
  stage: Stage;
  openStageCount: number;
  overdueTasks: number;
  openTasks: number;
  hasDecisionMaker: boolean;
  activitiesLast30: number;
  /** Median amount of open deals in the org, used to normalise deal value. */
  medianOpenAmount: number;
}

export const RISK_THRESHOLDS = { high: 60, medium: 30 } as const;

export function isOpen(stage: Stage): boolean {
  return !stage.is_won && !stage.is_lost;
}

export function scoreRisk(deal: Deal, ctx: ScoringContext): RiskResult {
  if (!isOpen(ctx.stage)) return { score: 0, level: "low", factors: [] };
  const factors: RiskFactor[] = [];
  const t = ctx.today;

  const lastTouch = deal.last_activity_at ?? deal.created_at;
  const idle = daysBetween(lastTouch.slice(0, 10), t);
  if (idle > 30) {
    factors.push({ code: "idle", label: "No recent activity", detail: `No logged activity for ${idle} days`, points: 30 });
  } else if (idle > 14) {
    factors.push({ code: "idle", label: "Activity slowing", detail: `Last activity ${idle} days ago`, points: 15 });
  }

  const toClose = daysBetween(t, deal.expected_close_date);
  if (toClose < 0) {
    factors.push({
      code: "overdue_close",
      label: "Close date passed",
      detail: `Expected close was ${-toClose} days ago and the deal is still open`,
      points: 25,
    });
  } else if (toClose <= 14 && ctx.stage.position <= 2) {
    factors.push({
      code: "early_stage_near_close",
      label: "Close date unrealistic",
      detail: `Closes in ${toClose} days but is only at ${ctx.stage.name}`,
      points: 15,
    });
  }

  const inStage = daysBetween(deal.stage_entered_at.slice(0, 10), t);
  const expected = ctx.stage.expected_days || 21;
  if (inStage > expected * 2) {
    factors.push({
      code: "stalled",
      label: "Stalled in stage",
      detail: `${inStage} days in ${ctx.stage.name} (typical: ${expected})`,
      points: 20,
    });
  } else if (inStage > expected * 1.5) {
    factors.push({
      code: "slow_stage",
      label: "Slow stage progress",
      detail: `${inStage} days in ${ctx.stage.name} (typical: ${expected})`,
      points: 10,
    });
  }

  if (!deal.next_step?.trim()) {
    factors.push({ code: "no_next_step", label: "No next step", detail: "No agreed next step recorded", points: 10 });
  } else if (deal.next_step_date && deal.next_step_date < t) {
    factors.push({
      code: "next_step_lapsed",
      label: "Next step lapsed",
      detail: `Next step was due ${daysBetween(deal.next_step_date, t)} days ago`,
      points: 10,
    });
  }

  if (ctx.overdueTasks > 0) {
    factors.push({
      code: "overdue_tasks",
      label: "Overdue follow-ups",
      detail: `${ctx.overdueTasks} follow-up${ctx.overdueTasks > 1 ? "s" : ""} past due`,
      points: Math.min(15, 5 * ctx.overdueTasks + 5),
    });
  }

  if (!ctx.hasDecisionMaker && ctx.stage.position >= 3) {
    factors.push({
      code: "no_decision_maker",
      label: "No decision-maker engaged",
      detail: "No contact on this deal is marked as a decision-maker",
      points: 10,
    });
  }

  if (deal.close_date_pushes >= 2) {
    factors.push({
      code: "slipping",
      label: "Repeatedly slipping",
      detail: `Close date moved out ${deal.close_date_pushes} times`,
      points: Math.min(20, deal.close_date_pushes * 5),
    });
  }

  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  const level = score >= RISK_THRESHOLDS.high ? "high" : score >= RISK_THRESHOLDS.medium ? "medium" : "low";
  return { score, level, factors: factors.sort((a, b) => b.points - a.points) };
}

/**
 * Priority = where a rep's next hour is best spent. Combines value, proximity
 * to close, stage progress and engagement, minus a penalty for high risk.
 */
export function scorePriority(deal: Deal, ctx: ScoringContext, risk: RiskResult): PriorityResult {
  if (!isOpen(ctx.stage)) return { score: 0, reasons: [] };
  const reasons: string[] = [];
  const median = Math.max(1, ctx.medianOpenAmount);

  const valueRatio = deal.amount / median;
  const value = Math.min(1, valueRatio / 3);
  if (valueRatio >= 2) reasons.push(`${valueRatio.toFixed(1)}× the median open deal size`);

  const toClose = daysBetween(ctx.today, deal.expected_close_date);
  const urgency = toClose < 0 ? 0.9 : toClose <= 30 ? 1 : toClose <= 60 ? 0.6 : toClose <= 90 ? 0.35 : 0.15;
  if (toClose >= 0 && toClose <= 30) reasons.push(`Expected to close in ${toClose} days`);
  if (toClose < 0) reasons.push("Close date has passed — needs a decision");

  const progress = ctx.openStageCount > 1 ? (ctx.stage.position - 1) / (ctx.openStageCount - 1) : 0;
  if (progress >= 0.75) reasons.push(`Late stage (${ctx.stage.name})`);

  const engagement = Math.min(1, ctx.activitiesLast30 / 4);
  if (ctx.activitiesLast30 >= 4) reasons.push("Strong recent engagement");

  const raw = 0.35 * value + 0.3 * urgency + 0.25 * progress + 0.1 * engagement;
  const riskPenalty = risk.level === "high" ? 0.1 : 0;
  if (risk.level === "high" && value >= 0.5) reasons.push("High value at high risk — intervene now");

  const score = Math.round(Math.max(0, Math.min(1, raw - riskPenalty + (risk.level === "high" && value >= 0.5 ? 0.15 : 0))) * 100);
  return { score, reasons };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
