import { addDays, daysBetween, fiscalQuarter, monthKey, recentQuarters, shiftQuarter, today, type Period } from "../../shared/dates.ts";
import { isOpen } from "../../shared/scoring.ts";
import type { DealRow, Stage } from "../../shared/types.ts";
import { all, get } from "../db.ts";
import { getOrg, getStages, loadDeals, type DealScope } from "./deals.ts";

/** All money figures here are computed deterministically from stored records. */

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const between = (s: string | null, p: Period) => !!s && s.slice(0, 10) >= p.start && s.slice(0, 10) <= p.end;
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

interface Ctx {
  T: string;
  fy: number;
  stages: Stage[];
  stageById: Map<number, Stage>;
  rows: DealRow[];
  won: (d: DealRow) => boolean;
  lost: (d: DealRow) => boolean;
  open: (d: DealRow) => boolean;
}

function context(scope: DealScope): Ctx {
  const stages = getStages(scope.orgId);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const rows = loadDeals(scope);
  return {
    T: today(),
    fy: getOrg(scope.orgId).fy_start_month,
    stages,
    stageById,
    rows,
    won: (d) => !!stageById.get(d.stage_id)?.is_won,
    lost: (d) => !!stageById.get(d.stage_id)?.is_lost,
    open: (d) => isOpen(stageById.get(d.stage_id)!),
  };
}

export function target(orgId: number, periodKey: string, userId?: number): number {
  const row = userId
    ? get<{ amount: number }>("SELECT amount FROM targets WHERE org_id = ? AND user_id = ? AND period_key = ?", orgId, userId, periodKey)
    : get<{ amount: number }>("SELECT amount FROM targets WHERE org_id = ? AND user_id IS NULL AND period_key = ?", orgId, periodKey);
  return row?.amount ?? 0;
}

function closedStats(c: Ctx, deals: DealRow[]) {
  const won = deals.filter(c.won);
  const lost = deals.filter(c.lost);
  return {
    won: won.length,
    lost: lost.length,
    wonAmount: sum(won.map((d) => d.amount)),
    lostAmount: sum(lost.map((d) => d.amount)),
    winRate: ratio(won.length, won.length + lost.length),
    valueWinRate: ratio(sum(won.map((d) => d.amount)), sum([...won, ...lost].map((d) => d.amount))),
    avgDeal: won.length ? sum(won.map((d) => d.amount)) / won.length : 0,
    avgCycle: won.length ? sum(won.map((d) => daysBetween(d.created_at, d.closed_at!))) / won.length : 0,
  };
}

export function dashboard(scope: DealScope) {
  const c = context(scope);
  const q = fiscalQuarter(c.T, c.fy);
  const prevQ = shiftQuarter(q, -1, c.fy);
  const trailing: Period = { key: "T4Q", label: "Last 4 quarters", start: shiftQuarter(q, -3, c.fy).start, end: c.T };

  const quarterTarget = target(scope.orgId, q.key, scope.ownerId);
  const wonQ = c.rows.filter((d) => c.won(d) && between(d.closed_at, q));
  const wonPrev = c.rows.filter((d) => c.won(d) && between(d.closed_at, prevQ));
  const open = c.rows.filter(c.open);
  const openInQ = open.filter((d) => d.expected_close_date <= q.end);
  const wonAmount = sum(wonQ.map((d) => d.amount));
  const gap = Math.max(0, quarterTarget - wonAmount);
  const weighted = (ds: DealRow[]) => sum(ds.map((d) => d.amount * c.stageById.get(d.stage_id)!.probability));
  const closedTrailing = c.rows.filter((d) => !c.open(d) && between(d.closed_at, trailing));
  const stats = closedStats(c, closedTrailing);

  const byStage = c.stages.filter(isOpen).map((s) => {
    const ds = open.filter((d) => d.stage_id === s.id);
    return { stageId: s.id, stage: s.name, probability: s.probability, count: ds.length, amount: sum(ds.map((d) => d.amount)), weighted: weighted(ds) };
  });

  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Number(c.T.slice(0, 4)), Number(c.T.slice(5, 7)) - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const monthly = months.map((m) => ({
    month: m,
    won: sum(c.rows.filter((d) => c.won(d) && d.closed_at && monthKey(d.closed_at) === m).map((d) => d.amount)),
    created: sum(c.rows.filter((d) => monthKey(d.created_at) === m).map((d) => d.amount)),
    target: target(scope.orgId, fiscalQuarter(`${m}-01`, c.fy).key, scope.ownerId) / 3,
  }));

  const riskSummary = (["high", "medium", "low"] as const).map((level) => {
    const ds = open.filter((d) => d.risk.level === level);
    return { level, count: ds.length, amount: sum(ds.map((d) => d.amount)) };
  });

  const taskWhere = scope.ownerId ? "AND t.assigned_to = ?" : "";
  const taskParams = scope.ownerId ? [scope.ownerId] : [];
  const taskCounts = get<{ overdue: number; today: number; week: number }>(
    `SELECT SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) overdue,
            SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) today,
            SUM(CASE WHEN due_date > ? AND due_date <= ? THEN 1 ELSE 0 END) week
       FROM tasks t WHERE org_id = ? AND status = 'open' ${taskWhere}`,
    c.T, c.T, c.T, addDays(c.T, 7), scope.orgId, ...taskParams,
  )!;
  const tasks = all(
    `SELECT t.*, d.name deal_name, a.name account_name, u.name assignee_name
       FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id LEFT JOIN accounts a ON a.id = d.account_id
       JOIN users u ON u.id = t.assigned_to
      WHERE t.org_id = ? AND t.status = 'open' AND t.due_date <= ? ${taskWhere}
      ORDER BY t.due_date, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 8`,
    scope.orgId, addDays(c.T, 2), ...taskParams,
  );

  return {
    period: q,
    daysLeft: daysBetween(c.T, q.end),
    daysInPeriod: daysBetween(q.start, q.end) + 1,
    kpis: {
      wonAmount,
      wonCount: wonQ.length,
      wonPrevAmount: sum(wonPrev.map((d) => d.amount)),
      target: quarterTarget,
      attainment: ratio(wonAmount, quarterTarget),
      gap,
      openAmount: sum(open.map((d) => d.amount)),
      openCount: open.length,
      weightedAmount: weighted(open),
      openInPeriodAmount: sum(openInQ.map((d) => d.amount)),
      coverage: gap > 0 ? ratio(sum(openInQ.map((d) => d.amount)), gap) : null,
      commitAmount: sum(openInQ.filter((d) => d.forecast_category === "commit").map((d) => d.amount)),
      winRate: stats.winRate,
      avgDeal: stats.avgDeal,
      avgCycle: stats.avgCycle,
      overdueTasks: taskCounts.overdue ?? 0,
      dueToday: taskCounts.today ?? 0,
      dueThisWeek: taskCounts.week ?? 0,
    },
    byStage,
    monthly,
    riskSummary,
    atRisk: open
      .filter((d) => d.risk.level !== "low")
      .sort((a, b) => b.risk.score * Math.sqrt(b.amount) - a.risk.score * Math.sqrt(a.amount))
      .slice(0, 7),
    priorities: [...open].sort((a, b) => b.priority.score - a.priority.score).slice(0, 7),
    tasks,
  };
}

/** Max open-stage position each deal reached, from stage history (won deals reached all). */
function reachedPositions(orgId: number): Map<number, number> {
  const rows = all<{ deal_id: number; pos: number; won: number }>(
    `SELECT h.deal_id, MAX(CASE WHEN s.is_won = 0 AND s.is_lost = 0 THEN s.position ELSE 0 END) pos, MAX(s.is_won) won
       FROM deal_stage_history h JOIN stages s ON s.id = h.to_stage_id JOIN deals d ON d.id = h.deal_id
      WHERE d.org_id = ? GROUP BY h.deal_id`,
    orgId,
  );
  return new Map(rows.map((r) => [r.deal_id, r.won ? 99 : r.pos]));
}

export function analytics(scope: DealScope, from?: string, to?: string) {
  const c = context(scope);
  const q = fiscalQuarter(c.T, c.fy);
  const window: Period = {
    key: "custom",
    label: "Selected range",
    start: from ?? shiftQuarter(q, -3, c.fy).start,
    end: to ?? c.T,
  };
  const closed = c.rows.filter((d) => !c.open(d) && between(d.closed_at, window));
  const overall = closedStats(c, closed);

  const groupBy = (key: (d: DealRow) => string) => {
    const groups = new Map<string, DealRow[]>();
    for (const d of closed) groups.set(key(d), [...(groups.get(key(d)) ?? []), d]);
    return [...groups.entries()].map(([name, ds]) => ({ name, ...closedStats(c, ds) })).sort((a, b) => b.wonAmount - a.wonAmount);
  };

  const openStages = c.stages.filter(isOpen);
  const reached = reachedPositions(scope.orgId);
  const cohort = c.rows.filter((d) => between(d.created_at, window));
  const funnel = openStages.map((s) => ({
    stage: s.name,
    count: cohort.filter((d) => (reached.get(d.id) ?? 1) >= s.position).length,
  }));
  funnel.push({ stage: "Closed Won", count: cohort.filter(c.won).length });
  const conversions = funnel.slice(1).map((f, i) => ({
    from: funnel[i].stage,
    to: f.stage,
    rate: ratio(f.count, funnel[i].count),
  }));

  const lossMap = new Map<string, { count: number; amount: number }>();
  for (const d of closed.filter(c.lost)) {
    const k = d.lost_reason || "Not recorded";
    const e = lossMap.get(k) ?? { count: 0, amount: 0 };
    lossMap.set(k, { count: e.count + 1, amount: e.amount + d.amount });
  }

  const quarters = recentQuarters(c.T, 6, c.fy).map((p) => {
    const ds = c.rows.filter((d) => !c.open(d) && between(d.closed_at, p));
    const st = closedStats(c, ds);
    return {
      quarter: p.label,
      key: p.key,
      won: st.wonAmount,
      lost: st.lostAmount,
      winRate: st.winRate,
      created: sum(c.rows.filter((d) => between(d.created_at, p)).map((d) => d.amount)),
      target: target(scope.orgId, p.key, scope.ownerId),
    };
  });

  const weeks: { week: string; call: number; email: number; meeting: number; demo: number; note: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = addDays(c.T, -7 * i - 6);
    const end = addDays(c.T, -7 * i);
    const acts = all<{ type: string; n: number }>(
      `SELECT type, COUNT(*) n FROM activities WHERE org_id = ? AND substr(occurred_at,1,10) BETWEEN ? AND ? ${scope.ownerId ? "AND user_id = ?" : ""} GROUP BY type`,
      scope.orgId, start, end, ...(scope.ownerId ? [scope.ownerId] : []),
    );
    const row = { week: start, call: 0, email: 0, meeting: 0, demo: 0, note: 0 };
    for (const a of acts) (row as any)[a.type] = a.n;
    weeks.push(row);
  }

  return {
    window,
    overall,
    bySource: groupBy((d) => d.source || "Unknown"),
    byRep: groupBy((d) => d.owner_name),
    byProduct: groupBy((d) => d.product_line || "Unspecified"),
    funnel,
    conversions,
    lossReasons: [...lossMap.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.count - a.count),
    quarters,
    activity: weeks,
    reps: repLeaderboard(scope, c, q),
  };
}

function repLeaderboard(scope: DealScope, c: Ctx, q: Period) {
  const users = all<{ id: number; name: string; title: string; role: string }>(
    `SELECT id, name, title, role FROM users WHERE org_id = ? AND role != 'owner' AND active = 1 ${scope.ownerId ? "AND id = ?" : ""} ORDER BY name`,
    scope.orgId, ...(scope.ownerId ? [scope.ownerId] : []),
  );
  const trailing: Period = { key: "T4Q", label: "", start: shiftQuarter(q, -3, c.fy).start, end: c.T };
  return users.map((u) => {
    const mine = c.rows.filter((d) => d.owner_id === u.id);
    const open = mine.filter(c.open);
    const wonQ = sum(mine.filter((d) => c.won(d) && between(d.closed_at, q)).map((d) => d.amount));
    const tgt = target(scope.orgId, q.key, u.id);
    const st = closedStats(c, mine.filter((d) => !c.open(d) && between(d.closed_at, trailing)));
    const acts = get<{ n: number }>("SELECT COUNT(*) n FROM activities WHERE user_id = ? AND occurred_at >= ?", u.id, addDays(c.T, -30))!.n;
    const overdue = get<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE assigned_to = ? AND status = 'open' AND due_date < ?", u.id, c.T)!.n;
    return {
      userId: u.id,
      name: u.name,
      title: u.title,
      wonQuarter: wonQ,
      target: tgt,
      attainment: ratio(wonQ, tgt),
      openAmount: sum(open.map((d) => d.amount)),
      openCount: open.length,
      highRisk: open.filter((d) => d.risk.level === "high").length,
      winRate: st.winRate,
      avgCycle: st.avgCycle,
      activities30: acts,
      overdueTasks: overdue,
    };
  });
}

/** Of closed deals that reached each stage in the trailing year, what share were won. */
function historicalStageWinRates(c: Ctx, orgId: number, q: Period) {
  const reached = reachedPositions(orgId);
  const start = shiftQuarter(q, -3, c.fy).start;
  const closed = c.rows.filter((d) => !c.open(d) && d.closed_at! >= start);
  return c.stages.filter(isOpen).map((s) => {
    const reachedStage = closed.filter((d) => (reached.get(d.id) ?? 1) >= s.position);
    const won = reachedStage.filter(c.won).length;
    return { stageId: s.id, stage: s.name, configured: s.probability, historical: ratio(won, reachedStage.length), sample: reachedStage.length };
  });
}

export function forecast(scope: DealScope, periodKey?: string) {
  const c = context(scope);
  const current = fiscalQuarter(c.T, c.fy);
  const options = [-2, -1, 0, 1].map((n) => shiftQuarter(current, n, c.fy));
  const period = options.find((p) => p.key === periodKey) ?? current;
  const isCurrent = period.key === current.key;

  const won = c.rows.filter((d) => c.won(d) && between(d.closed_at, period));
  // Open deals whose close date already passed are still expected this quarter.
  const open = c.rows.filter(
    (d) => c.open(d) && (between(d.expected_close_date, period) || (isCurrent && d.expected_close_date < period.start)),
  );
  const byCat = (cat: string, ds = open) => sum(ds.filter((d) => d.forecast_category === cat).map((d) => d.amount));
  const tgt = target(scope.orgId, period.key, scope.ownerId);

  const users = all<{ id: number; name: string }>(
    `SELECT id, name FROM users WHERE org_id = ? AND role != 'owner' AND active = 1 ${scope.ownerId ? "AND id = ?" : ""} ORDER BY name`,
    scope.orgId, ...(scope.ownerId ? [scope.ownerId] : []),
  );

  return {
    period,
    options,
    isCurrent,
    target: tgt,
    won: sum(won.map((d) => d.amount)),
    wonCount: won.length,
    commit: byCat("commit"),
    bestCase: byCat("best_case"),
    pipeline: byCat("pipeline"),
    omitted: byCat("omitted"),
    weighted: sum(open.filter((d) => d.forecast_category !== "omitted").map((d) => d.amount * c.stageById.get(d.stage_id)!.probability)),
    stageRates: historicalStageWinRates(c, scope.orgId, current),
    byRep: users.map((u) => {
      const mine = open.filter((d) => d.owner_id === u.id);
      return {
        userId: u.id,
        name: u.name,
        target: target(scope.orgId, period.key, u.id),
        won: sum(won.filter((d) => d.owner_id === u.id).map((d) => d.amount)),
        commit: byCat("commit", mine),
        bestCase: byCat("best_case", mine),
        pipeline: byCat("pipeline", mine),
      };
    }),
    deals: open.sort((a, b) => b.amount - a.amount),
  };
}
