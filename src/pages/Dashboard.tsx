import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthLabel, type Period } from "../../shared/dates.ts";
import { fmtShortDate, inrCompact, pct } from "../../shared/format.ts";
import type { DealRow, Task } from "../../shared/types.ts";
import { Icon } from "../components/icons";
import { Card, ChartTooltip, Empty, ErrorState, Kpi, Loading, Money, PageHead, RiskBadge, ScoreRing } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";

export interface DashboardData {
  period: Period;
  daysLeft: number;
  daysInPeriod: number;
  kpis: {
    wonAmount: number;
    wonCount: number;
    wonPrevAmount: number;
    target: number;
    attainment: number;
    gap: number;
    openAmount: number;
    openCount: number;
    weightedAmount: number;
    openInPeriodAmount: number;
    coverage: number | null;
    commitAmount: number;
    winRate: number;
    avgDeal: number;
    avgCycle: number;
    overdueTasks: number;
    dueToday: number;
    dueThisWeek: number;
  };
  byStage: { stageId: number; stage: string; probability: number; count: number; amount: number; weighted: number }[];
  monthly: { month: string; won: number; created: number; target: number }[];
  riskSummary: { level: string; count: number; amount: number }[];
  atRisk: DealRow[];
  priorities: DealRow[];
  tasks: (Task & { deal_name: string | null; account_name: string | null })[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Dashboard() {
  const { user, viewAs, toast } = useApp();
  const meta = useMeta();
  const { data, error, loading, reload } = useApi<DashboardData>(`/dashboard${qs({ owner: viewAs })}`);
  const scopeName = viewAs ? meta.users.find((u) => u.id === viewAs)?.name : user!.role === "rep" ? "Your deals" : "Whole team";

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const k = data.kpis;
  const elapsed = 1 - data.daysLeft / data.daysInPeriod;
  const paceAmount = k.target * elapsed;
  const vsPace = k.wonAmount - paceAmount;
  const high = data.riskSummary.find((r) => r.level === "high")!;

  async function complete(t: Task) {
    await api.patch(`/tasks/${t.id}`, { status: "done" });
    toast("Follow-up completed");
    reload();
  }

  return (
    <>
      <PageHead title={`${greeting()}, ${user!.name.split(" ")[0]}`} subtitle={`${data.period.label} · ${data.daysLeft} days left · ${scopeName}`}>
        <Link className="btn" to="/insights">
          <Icon.Spark /> View insights
        </Link>
        <Link className="btn" to="/forecast">
          <Icon.Target /> Forecast
        </Link>
      </PageHead>

      <section className="hero mb">
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="label">Revenue won · {data.period.label}</div>
          <div className="row" style={{ alignItems: "baseline", gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: 34, fontWeight: 600, color: "#fff", letterSpacing: "-0.02em" }}>
              <Money value={k.wonAmount} />
            </span>
            <span style={{ color: "#a7c3bf" }}>
              of <Money value={k.target} /> target · {pct(k.attainment)}
            </span>
          </div>
          <div className="progress" style={{ marginTop: 14, height: 8 }}>
            <span style={{ width: `${Math.min(100, k.attainment * 100)}%` }} />
            <i className="pace" style={{ left: `${elapsed * 100}%` }} title="Where you should be today on a straight-line pace" />
          </div>
          <p style={{ marginTop: 10, color: "#cfe0dc", fontSize: 13 }}>
            {k.target === 0
              ? "No target set for this period — add one in Settings."
              : vsPace >= 0
                ? `Ahead of straight-line pace by ${inrCompact(vsPace)}. ${k.wonCount} deals won so far.`
                : `${inrCompact(-vsPace)} behind straight-line pace. ${inrCompact(k.gap)} still needed with ${data.daysLeft} days left.`}
          </p>
        </div>
        <div className="hero-figs">
          <div className="hero-fig">
            <div className="v">
              <Money value={k.commitAmount} />
            </div>
            <div className="l">Commit this quarter</div>
          </div>
          <div className="hero-fig">
            <div className="v">{k.coverage === null ? "—" : `${k.coverage.toFixed(1)}×`}</div>
            <div className="l">Pipeline coverage of gap</div>
          </div>
          <div className="hero-fig">
            <div className="v">
              <Money value={k.weightedAmount} />
            </div>
            <div className="l">Weighted pipeline</div>
          </div>
        </div>
      </section>

      <div className="grid g-4 mb">
        <Kpi label="Open pipeline" value={<Money value={k.openAmount} />} sub={`${k.openCount} open deals · ${inrCompact(k.openInPeriodAmount)} due this quarter`} />
        <Kpi label="Win rate (last 4 quarters)" value={pct(k.winRate)} sub="Won ÷ (won + lost), by count" />
        <Kpi label="Average won deal" value={<Money value={k.avgDeal} />} sub={`Sales cycle ≈ ${Math.round(k.avgCycle)} days`} />
        <Kpi
          label="At-risk pipeline"
          value={<Money value={high.amount} />}
          tone={high.count ? "danger" : undefined}
          sub={
            <Link to="/pipeline?risk=high">
              {high.count} high-risk deals <Icon.Arrow size={12} />
            </Link>
          }
        />
      </div>

      <div className="grid g-7-5 mb">
        <Card title="Revenue trend" subtitle="Won revenue by month against the monthly share of target">
          <div style={{ height: 260, padding: "12px 12px 4px 0" }}>
            <ResponsiveContainer>
              <ComposedChart data={data.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                <CartesianGrid stroke="#efece4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#65736f" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => inrCompact(v)} tick={{ fontSize: 11, fill: "#65736f" }} axisLine={false} tickLine={false} width={64} />
                <Tooltip content={<ChartTooltip format={inrCompact} />} cursor={{ fill: "rgba(15,61,62,0.04)" }} />
                <Bar dataKey="won" name="Won" fill="#0f3d3e" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line dataKey="target" name="Target / month" stroke="#d6982a" strokeWidth={2} dot={false} strokeDasharray="4 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Pipeline by stage" subtitle="Open value, with weighted value from stage probability" actions={<Link to="/pipeline" className="btn btn-sm">Open board</Link>}>
          <div style={{ height: 260, padding: "12px 16px 4px 0" }}>
            <ResponsiveContainer>
              <BarChart data={data.byStage} layout="vertical" barGap={2}>
                <CartesianGrid stroke="#efece4" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => inrCompact(v)} tick={{ fontSize: 11, fill: "#65736f" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stage" tick={{ fontSize: 12, fill: "#2c3b39" }} axisLine={false} tickLine={false} width={90} />
                <Tooltip content={<ChartTooltip format={inrCompact} />} cursor={{ fill: "rgba(15,61,62,0.04)" }} />
                <Bar dataKey="amount" name="Open value" fill="#c9d9d6" radius={[0, 4, 4, 0]} maxBarSize={14} />
                <Bar dataKey="weighted" name="Weighted" fill="#17575a" radius={[0, 4, 4, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid g-3">
        <Card title="Needs attention" subtitle="Highest risk, weighted by deal value" actions={<Link className="btn btn-sm" to="/pipeline?risk=high">All</Link>}>
          {data.atRisk.length === 0 ? (
            <Empty title="No at-risk deals">Every open deal has recent activity and a valid next step.</Empty>
          ) : (
            data.atRisk.map((d) => (
              <Link key={d.id} to={`/deals/${d.id}`} className="list-item">
                <ScoreRing score={d.risk.score} kind="risk" />
                <div className="grow">
                  <div className="strong ellipsis">{d.name}</div>
                  <div className="small muted ellipsis">{d.risk.factors[0]?.detail}</div>
                </div>
                <div className="strong small">
                  <Money value={d.amount} />
                </div>
              </Link>
            ))
          )}
        </Card>
        <Card title="Top priorities" subtitle="Where the next hour is best spent">
          {data.priorities.map((d) => (
            <Link key={d.id} to={`/deals/${d.id}`} className="list-item">
              <ScoreRing score={d.priority.score} kind="priority" />
              <div className="grow">
                <div className="strong ellipsis">{d.name}</div>
                <div className="small muted ellipsis">{d.priority.reasons[0] ?? `${d.stage_name} · closes ${fmtShortDate(d.expected_close_date)}`}</div>
              </div>
              <div className="stack-sm" style={{ alignItems: "flex-end", gap: 2 }}>
                <span className="strong small">
                  <Money value={d.amount} />
                </span>
                {d.risk.level !== "low" && <RiskBadge risk={d.risk} />}
              </div>
            </Link>
          ))}
        </Card>
        <Card
          title="Follow-ups"
          subtitle={`${k.overdueTasks} overdue · ${k.dueToday} due today · ${k.dueThisWeek} later this week`}
          actions={<Link className="btn btn-sm" to="/follow-ups">All</Link>}
        >
          {data.tasks.length === 0 ? (
            <Empty title="You're all caught up">No follow-ups due in the next two days.</Empty>
          ) : (
            data.tasks.map((t) => (
              <div key={t.id} className="list-item">
                <input type="checkbox" onChange={() => complete(t)} aria-label={`Complete ${t.title}`} />
                <div className="grow">
                  <div className="strong ellipsis small">{t.title}</div>
                  <div className="tiny muted ellipsis">
                    {t.deal_id ? <Link to={`/deals/${t.deal_id}`}>{t.deal_name}</Link> : "General"} · {t.assignee_name}
                  </div>
                </div>
                <span className={`badge ${t.due_date < meta.today ? "b-high" : t.due_date === meta.today ? "b-medium" : ""}`}>
                  {t.due_date < meta.today ? `Overdue · ${fmtShortDate(t.due_date)}` : t.due_date === meta.today ? "Today" : fmtShortDate(t.due_date)}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
