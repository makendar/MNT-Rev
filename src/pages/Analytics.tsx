import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fiscalYear, shiftQuarter } from "../../shared/dates.ts";
import { fmtShortDate, inrCompact, pct } from "../../shared/format.ts";
import { Card, ChartTooltip, ErrorState, Kpi, Loading, Money, PageHead } from "../components/ui";
import { qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";

interface GroupStat {
  name: string;
  won: number;
  lost: number;
  wonAmount: number;
  lostAmount: number;
  winRate: number;
  avgDeal: number;
  avgCycle: number;
}

interface AnalyticsData {
  window: { start: string; end: string };
  overall: Omit<GroupStat, "name"> & { valueWinRate: number };
  bySource: GroupStat[];
  byRep: GroupStat[];
  byProduct: GroupStat[];
  funnel: { stage: string; count: number }[];
  conversions: { from: string; to: string; rate: number }[];
  lossReasons: { reason: string; count: number; amount: number }[];
  quarters: { quarter: string; won: number; lost: number; winRate: number; created: number; target: number }[];
  activity: { week: string; call: number; email: number; meeting: number; demo: number; note: number }[];
  reps: {
    userId: number;
    name: string;
    title: string;
    wonQuarter: number;
    target: number;
    attainment: number;
    openAmount: number;
    openCount: number;
    highRisk: number;
    winRate: number;
    avgCycle: number;
    activities30: number;
    overdueTasks: number;
  }[];
}

const AXIS = { fontSize: 11, fill: "#65736f" };

export function Analytics() {
  const meta = useMeta();
  const { viewAs, isManager } = useApp();
  const [range, setRange] = useState("4q");
  const ranges: Record<string, { from?: string; to?: string; label: string }> = {
    "4q": { label: "Last 4 quarters" },
    "2q": { from: shiftQuarter(meta.currentPeriod, -1, meta.org.fy_start_month).start, to: meta.today, label: "Last 2 quarters" },
    fytd: { from: fiscalYear(meta.today, meta.org.fy_start_month).start, to: meta.today, label: "Financial year to date" },
    q: { from: meta.currentPeriod.start, to: meta.today, label: "This quarter" },
  };
  const r = ranges[range];
  const { data, error, loading, reload } = useApi<AnalyticsData>(`/analytics${qs({ from: r.from, to: r.to, owner: viewAs })}`);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const o = data.overall;
  const maxFunnel = Math.max(1, ...data.funnel.map((f) => f.count));

  return (
    <>
      <PageHead title="Analytics" subtitle={`Closed deals ${fmtShortDate(data.window.start)} – ${fmtShortDate(data.window.end)}. All figures computed directly from deal records.`}>
        <div className="seg">
          {Object.entries(ranges).map(([k, v]) => (
            <button key={k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>
              {v.label}
            </button>
          ))}
        </div>
      </PageHead>

      <div className="grid g-4 mb">
        <Kpi label="Won revenue" value={<Money value={o.wonAmount} />} sub={`${o.won} deals won · ${o.lost} lost`} />
        <Kpi label="Win rate" value={pct(o.winRate)} sub={`By value: ${pct(o.valueWinRate)}`} />
        <Kpi label="Average won deal" value={<Money value={o.avgDeal} />} sub={`Lost value ${inrCompact(o.lostAmount)}`} />
        <Kpi label="Average sales cycle" value={`${Math.round(o.avgCycle)} days`} sub="Created → closed won" />
      </div>

      <div className="grid g-7-5 mb">
        <Card title="Quarterly performance" subtitle="Won vs target, with win rate">
          <div style={{ height: 270, padding: "12px 4px 4px 0" }}>
            <ResponsiveContainer>
              <ComposedChart data={data.quarters}>
                <CartesianGrid stroke="#efece4" vertical={false} />
                <XAxis dataKey="quarter" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tickFormatter={inrCompact} tick={AXIS} axisLine={false} tickLine={false} width={64} />
                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => pct(v)} tick={AXIS} axisLine={false} tickLine={false} width={40} domain={[0, 1]} />
                <Tooltip content={<ChartTooltip format={(v: number, key: string) => (key === "winRate" ? pct(v) : inrCompact(v))} />} cursor={{ fill: "rgba(15,61,62,0.04)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />
                <Bar yAxisId="l" dataKey="won" name="Won" fill="#0f3d3e" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Bar yAxisId="l" dataKey="target" name="Target" fill="#e4e0d6" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Line yAxisId="r" dataKey="winRate" name="Win rate" stroke="#d6982a" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Conversion funnel" subtitle="Deals created in range, by furthest stage reached">
          <div className="card-body stack-sm">
            {data.funnel.map((f, i) => (
              <div key={f.stage}>
                <div className="row-between small">
                  <span>{f.stage}</span>
                  <span className="num strong">{f.count}</span>
                </div>
                <div style={{ height: 18, background: "var(--line-2)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${(f.count / maxFunnel) * 100}%`, height: "100%", background: i === data.funnel.length - 1 ? "var(--ok)" : "var(--brand-2)", opacity: 1 - i * 0.08 }} />
                </div>
                {data.conversions[i] && (
                  <div className={`tiny ${data.conversions[i].rate < 0.5 ? "warn-text" : "muted"}`} style={{ margin: "2px 0 2px 4px" }}>
                    ↓ {pct(data.conversions[i].rate)} convert
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {isManager && !viewAs && (
        <Card title="Team performance" subtitle="Current quarter attainment, with leading indicators" className="mb">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Salesperson</th>
                  <th style={{ width: 200 }}>Quarter attainment</th>
                  <th className="r">Open pipeline</th>
                  <th className="r">High-risk deals</th>
                  <th className="r">Win rate (4Q)</th>
                  <th className="r">Avg cycle</th>
                  <th className="r">Activities (30d)</th>
                  <th className="r">Overdue follow-ups</th>
                </tr>
              </thead>
              <tbody>
                {data.reps.map((r) => (
                  <tr key={r.userId}>
                    <td>
                      <div className="cell-title">{r.name}</div>
                      <div className="cell-sub">{r.title}</div>
                    </td>
                    <td>
                      <div className="row-between small">
                        <span className="num">
                          {inrCompact(r.wonQuarter)} / {inrCompact(r.target)}
                        </span>
                        <b className="num">{pct(r.attainment)}</b>
                      </div>
                      <div className="progress" style={{ marginTop: 4 }}>
                        <span style={{ width: `${Math.min(100, r.attainment * 100)}%` }} />
                      </div>
                    </td>
                    <td className="r">
                      <Money value={r.openAmount} /> <span className="muted small">({r.openCount})</span>
                    </td>
                    <td className={`r num ${r.highRisk >= 3 ? "danger-text strong" : ""}`}>{r.highRisk}</td>
                    <td className={`r num ${r.winRate < o.winRate - 0.08 ? "warn-text strong" : ""}`}>{pct(r.winRate)}</td>
                    <td className="r num">{Math.round(r.avgCycle)}d</td>
                    <td className="r num">{r.activities30}</td>
                    <td className={`r num ${r.overdueTasks >= 8 ? "danger-text strong" : ""}`}>{r.overdueTasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid g-2 mb">
        <Card title="Lead source performance" subtitle="Win rate and won value by where the deal came from">
          <GroupTable rows={data.bySource} overall={o.winRate} />
        </Card>
        <Card title="Why deals are lost" subtitle="Recorded loss reasons in range">
          <div style={{ height: 260, padding: "12px 16px 4px 0" }}>
            <ResponsiveContainer>
              <BarChart data={data.lossReasons} layout="vertical">
                <CartesianGrid stroke="#efece4" horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="reason" tick={{ fontSize: 12, fill: "#2c3b39" }} axisLine={false} tickLine={false} width={150} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,61,62,0.04)" }} />
                <Bar dataKey="count" name="Deals lost" fill="#b2432e" radius={[0, 4, 4, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid g-2">
        <Card title="Product / service lines">
          <GroupTable rows={data.byProduct} overall={o.winRate} />
        </Card>
        <Card title="Sales activity" subtitle="Logged activities per week, last 8 weeks">
          <div style={{ height: 260, padding: "12px 12px 4px 0" }}>
            <ResponsiveContainer>
              <BarChart data={data.activity.map((w) => ({ ...w, label: fmtShortDate(w.week) }))}>
                <CartesianGrid stroke="#efece4" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,61,62,0.04)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />
                <Bar dataKey="call" name="Calls" stackId="a" fill="#0f3d3e" />
                <Bar dataKey="email" name="Emails" stackId="a" fill="#4c8a83" />
                <Bar dataKey="meeting" name="Meetings" stackId="a" fill="#d6982a" />
                <Bar dataKey="demo" name="Demos" stackId="a" fill="#e9c27a" />
                <Bar dataKey="note" name="Notes" stackId="a" fill="#cfdcd9" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </>
  );
}

function GroupTable({ rows, overall }: { rows: GroupStat[]; overall: number }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th className="r">Won / closed</th>
            <th style={{ width: 150 }}>Win rate</th>
            <th className="r">Won value</th>
            <th className="r">Avg deal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="cell-title">{r.name}</td>
              <td className="r num">
                {r.won} / {r.won + r.lost}
              </td>
              <td>
                <div className="row" style={{ gap: 8 }}>
                  <div className="progress" style={{ marginTop: 0, flex: 1 }}>
                    <span style={{ width: `${r.winRate * 100}%`, background: r.winRate >= overall ? "var(--ok)" : "var(--warn)" }} />
                  </div>
                  <span className="num small strong" style={{ width: 34, textAlign: "right" }}>
                    {pct(r.winRate)}
                  </span>
                </div>
              </td>
              <td className="r">
                <Money value={r.wonAmount} />
              </td>
              <td className="r">{r.won ? <Money value={r.avgDeal} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
