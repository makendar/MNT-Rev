import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Period } from "../../shared/dates.ts";
import { fmtShortDate, inrCompact, pct } from "../../shared/format.ts";
import type { DealRow } from "../../shared/types.ts";
import { Card, CATEGORY_LABEL, Empty, ErrorState, Kpi, Loading, Money, PageHead, RiskBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";

interface ForecastData {
  period: Period;
  options: Period[];
  isCurrent: boolean;
  target: number;
  won: number;
  wonCount: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  omitted: number;
  weighted: number;
  stageRates: { stageId: number; stage: string; configured: number; historical: number; sample: number }[];
  byRep: { userId: number; name: string; target: number; won: number; commit: number; bestCase: number; pipeline: number }[];
  deals: DealRow[];
}

const SEG_COLORS = { won: "#0f3d3e", commit: "#2f7d6d", best: "#d6982a", pipe: "#cfdcd9" };

export function Forecast() {
  const { viewAs, toast } = useApp();
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const period = params.get("period") ?? "";
  const { data, error, loading, reload } = useApi<ForecastData>(`/forecast${qs({ period, owner: viewAs })}`);
  const [a, setA] = useState({ commit: 90, best: 50, pipe: 10 });
  const [catFilter, setCatFilter] = useState("");

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const projected = data.won + (data.commit * a.commit + data.bestCase * a.best + data.pipeline * a.pipe) / 100;
  const ceiling = data.won + data.commit + data.bestCase + data.pipeline;
  const scale = Math.max(ceiling, data.target) || 1;
  const segs = [
    { key: "won", label: "Won", v: data.won, c: SEG_COLORS.won },
    { key: "commit", label: "Commit", v: data.commit, c: SEG_COLORS.commit },
    { key: "best", label: "Best case", v: data.bestCase, c: SEG_COLORS.best },
    { key: "pipe", label: "Pipeline", v: data.pipeline, c: SEG_COLORS.pipe },
  ];

  async function setCategory(d: DealRow, cat: string) {
    try {
      await api.patch(`/deals/${d.id}`, { forecast_category: cat });
      toast(`${d.name}: ${CATEGORY_LABEL[cat]}`);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const deals = data.deals.filter((d) => !catFilter || d.forecast_category === catFilter);
  const misaligned = data.stageRates.filter((s) => s.sample >= 8 && Math.abs(s.configured - s.historical) >= 0.15);

  return (
    <>
      <PageHead title="Forecast" subtitle="Rep-judged categories combined with adjustable conversion assumptions. A planning range, not a prediction.">
        <select value={data.period.key} onChange={(e) => setParams(e.target.value === meta.currentPeriod.key ? {} : { period: e.target.value })} aria-label="Period">
          {data.options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
              {o.key === meta.currentPeriod.key ? " (current)" : ""}
            </option>
          ))}
        </select>
      </PageHead>

      <div className="grid g-4 mb">
        <Kpi label="Target" value={<Money value={data.target} />} sub={`${fmtShortDate(data.period.start)} – ${fmtShortDate(data.period.end)}`} />
        <Kpi label="Won" value={<Money value={data.won} />} sub={`${data.wonCount} deals · ${pct(data.target ? data.won / data.target : 0)} of target`} progress={data.target ? data.won / data.target : 0} />
        <Kpi
          label="Projected (your assumptions)"
          value={<Money value={projected} />}
          tone={data.target && projected < data.target ? "danger" : "ok"}
          sub={data.target ? `${pct(projected / data.target)} of target · gap ${inrCompact(Math.max(0, data.target - projected))}` : undefined}
        />
        <Kpi label="Stage-weighted" value={<Money value={data.won + data.weighted} />} sub="Won + open × stage probability" />
      </div>

      <div className="grid g-7-5 mb">
        <Card title="Forecast build-up" subtitle="Each segment stacks on the last. The marker is the target.">
          <div className="card-body">
            <div style={{ position: "relative", height: 40, borderRadius: 8, overflow: "hidden", display: "flex", background: "var(--line-2)" }}>
              {segs.map((s) => (
                <div key={s.key} title={`${s.label}: ${inrCompact(s.v)}`} style={{ width: `${(s.v / scale) * 100}%`, background: s.c }} />
              ))}
            </div>
            <div style={{ position: "relative", height: 22 }}>
              {data.target > 0 && (
                <div style={{ position: "absolute", left: `${(data.target / scale) * 100}%`, top: -46, bottom: 0, borderLeft: "2px dashed var(--danger)" }}>
                  <span className="tiny strong danger-text" style={{ position: "absolute", top: 48, left: 4, whiteSpace: "nowrap" }}>
                    Target {inrCompact(data.target)}
                  </span>
                </div>
              )}
            </div>
            <div className="legend mt">
              {segs.map((s) => (
                <span key={s.key}>
                  <i style={{ background: s.c }} />
                  {s.label} <b className="num" style={{ color: "var(--ink)" }}>{inrCompact(s.v)}</b>
                </span>
              ))}
            </div>
            {data.isCurrent && <p className="tiny muted mt-sm">Open deals with a past close date are counted in the current quarter until they are updated.</p>}
          </div>
        </Card>
        <Card title="Scenario assumptions" subtitle="Share of each category you expect to close this period">
          <div className="card-body stack">
            {(
              [
                ["commit", "Commit", SEG_COLORS.commit, data.commit],
                ["best", "Best case", SEG_COLORS.best, data.bestCase],
                ["pipe", "Pipeline", "#9fb5b1", data.pipeline],
              ] as const
            ).map(([k, label, color, base]) => (
              <div key={k}>
                <div className="row-between small">
                  <span>
                    <i style={{ display: "inline-block", width: 10, height: 10, background: color, borderRadius: 2, marginRight: 6 }} />
                    {label} · {inrCompact(base)}
                  </span>
                  <span className="strong num">
                    {a[k]}% → {inrCompact((base * a[k]) / 100)}
                  </span>
                </div>
                <input type="range" min={0} max={100} step={5} value={a[k]} onChange={(e) => setA({ ...a, [k]: Number(e.target.value) })} style={{ width: "100%" }} aria-label={`${label} conversion`} />
              </div>
            ))}
            <div className="row">
              <button className="btn btn-sm" onClick={() => setA({ commit: 90, best: 50, pipe: 10 })}>
                Reset defaults
              </button>
              <button className="btn btn-sm" onClick={() => setA({ commit: 100, best: 100, pipe: 0 })}>
                Upside case
              </button>
              <button className="btn btn-sm" onClick={() => setA({ commit: 75, best: 25, pipe: 0 })}>
                Conservative
              </button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g-7-5 mb">
        <Card title="By salesperson">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Owner</th>
                  <th className="r">Target</th>
                  <th className="r">Won</th>
                  <th className="r">Commit</th>
                  <th className="r">Best case</th>
                  <th className="r">Projected</th>
                  <th className="r">vs target</th>
                </tr>
              </thead>
              <tbody>
                {data.byRep.map((r) => {
                  const p = r.won + (r.commit * a.commit + r.bestCase * a.best + r.pipeline * a.pipe) / 100;
                  return (
                    <tr key={r.userId}>
                      <td className="cell-title">{r.name}</td>
                      <td className="r">
                        <Money value={r.target} />
                      </td>
                      <td className="r">
                        <Money value={r.won} />
                      </td>
                      <td className="r">
                        <Money value={r.commit} />
                      </td>
                      <td className="r">
                        <Money value={r.bestCase} />
                      </td>
                      <td className="r strong">
                        <Money value={p} />
                      </td>
                      <td className={`r strong ${r.target && p < r.target ? "danger-text" : "ok-text"}`}>{r.target ? pct(p / r.target) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Are stage probabilities realistic?" subtitle="Configured probability vs. share of deals reaching each stage that were won (last 4 quarters)">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="r">Configured</th>
                  <th className="r">Historical</th>
                  <th className="r">Sample</th>
                </tr>
              </thead>
              <tbody>
                {data.stageRates.map((s) => {
                  const off = s.sample >= 8 && Math.abs(s.configured - s.historical) >= 0.15;
                  return (
                    <tr key={s.stageId}>
                      <td>{s.stage}</td>
                      <td className="r num">{pct(s.configured)}</td>
                      <td className={`r num strong ${off ? "warn-text" : ""}`}>{s.sample ? pct(s.historical) : "—"}</td>
                      <td className="r muted num">{s.sample}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {misaligned.length > 0 && (
            <div className="card-body" style={{ paddingTop: 0 }}>
              <div className="notice warn">
                {misaligned.map((s) => s.stage).join(", ")} probabilit{misaligned.length > 1 ? "ies differ" : "y differs"} from history by 15+ points. Consider updating them in{" "}
                <Link to="/settings">Settings</Link>.
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card
        title={`Deals in ${data.period.label}`}
        subtitle="Change a category to update the forecast instantly"
        actions={
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Category filter" style={{ height: 30 }}>
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        }
      >
        {deals.length === 0 ? (
          <Empty title="No open deals in this period" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Owner</th>
                  <th>Stage</th>
                  <th>Close</th>
                  <th className="r">Amount</th>
                  <th>Risk</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/deals/${d.id}`} className="cell-title">
                        {d.name}
                      </Link>
                      <div className="cell-sub">{d.account_name}</div>
                    </td>
                    <td>{d.owner_name}</td>
                    <td>{d.stage_name}</td>
                    <td className={d.expected_close_date < meta.today ? "danger-text" : ""}>{fmtShortDate(d.expected_close_date)}</td>
                    <td className="r strong">
                      <Money value={d.amount} />
                    </td>
                    <td>
                      <RiskBadge risk={d.risk} />
                    </td>
                    <td>
                      <select value={d.forecast_category} onChange={(e) => setCategory(d, e.target.value)} style={{ height: 28 }} aria-label={`Category for ${d.name}`}>
                        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
