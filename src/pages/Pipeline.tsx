import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { addDays } from "../../shared/dates.ts";
import { fmtDate, fmtShortDate, inrCompact } from "../../shared/format.ts";
import { isOpen } from "../../shared/scoring.ts";
import type { DealRow, Stage } from "../../shared/types.ts";
import { LostReasonModal } from "../components/forms";
import { Icon } from "../components/icons";
import { CATEGORY_LABEL, Empty, ErrorState, Loading, Money, PageHead, RiskBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";

const FLAG_LABEL: Record<string, string> = {
  overdue_close: "Close date passed",
  idle: "No recent activity",
  stalled: "Stalled in stage",
  no_next_step: "No next step",
  overdue_tasks: "Overdue follow-ups",
};

type SortKey = "name" | "amount" | "expected_close_date" | "risk" | "priority" | "stage";

export function Pipeline() {
  const meta = useMeta();
  const { isManager, viewAs, toast } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "board";
  const status = view === "table" ? params.get("status") ?? "open" : "open";
  const owner = params.get("owner") ?? (viewAs ? String(viewAs) : "");
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const { data, error, loading, reload, setData } = useApi<DealRow[]>(
    `/deals${qs({ status: status === "all" ? undefined : status, owner, source: params.get("source"), risk: params.get("risk"), flag: params.get("flag"), q: params.get("q") })}`,
  );

  const close = params.get("close") ?? "";
  const filtered = useMemo(() => {
    if (!data) return [];
    const p = meta.currentPeriod;
    return data.filter((d) => {
      if (close === "quarter") return d.expected_close_date <= p.end;
      if (close === "30d") return d.expected_close_date >= meta.today && d.expected_close_date <= addDays(meta.today, 30);
      if (close === "overdue") return d.expected_close_date < meta.today;
      return true;
    });
  }, [data, close, meta]);

  const [lostFor, setLostFor] = useState<DealRow | null>(null);

  async function moveTo(deal: DealRow, stage: Stage, lostReason?: string) {
    if (deal.stage_id === stage.id) return;
    if (stage.is_lost && !lostReason) return setLostFor(deal);
    const prev = data;
    setData((rows) => rows?.map((r) => (r.id === deal.id ? { ...r, stage_id: stage.id, stage_name: stage.name } : r)) ?? null);
    try {
      await api.patch(`/deals/${deal.id}`, { stage_id: stage.id, lost_reason: lostReason });
      toast(stage.is_won ? `${deal.name} marked as won` : `${deal.name} moved to ${stage.name}`);
      reload();
    } catch (e) {
      setData(prev);
      toast((e as Error).message, "error");
    }
  }

  const total = filtered.reduce((s, d) => s + d.amount, 0);
  const activeFilters = ["risk", "flag", "source", "close", "q"].filter((k) => params.get(k));

  return (
    <>
      <PageHead
        title="Pipeline"
        subtitle={
          <>
            {filtered.length} deals · <Money value={total} /> {status === "open" ? "open" : status}
            {params.get("flag") && <> · filtered to “{FLAG_LABEL[params.get("flag")!] ?? params.get("flag")}”</>}
          </>
        }
      >
        <div className="seg" role="tablist">
          <button className={view === "board" ? "active" : ""} onClick={() => setParam("view", "")}>
            Board
          </button>
          <button className={view === "table" ? "active" : ""} onClick={() => setParam("view", "table")}>
            Table
          </button>
        </div>
        <a className="btn" href="/api/export/deals.csv">
          <Icon.Download /> Export CSV
        </a>
      </PageHead>

      <div className="filters">
        <input type="search" placeholder="Filter by deal or account" defaultValue={params.get("q") ?? ""} onChange={(e) => setParam("q", e.target.value)} aria-label="Filter" />
        {isManager && (
          <select value={owner} onChange={(e) => setParam("owner", e.target.value)} aria-label="Owner">
            <option value="">All owners</option>
            {meta.users.filter((u) => u.role !== "owner").map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <select value={params.get("risk") ?? ""} onChange={(e) => setParam("risk", e.target.value)} aria-label="Risk">
          <option value="">Any risk</option>
          <option value="high">High risk</option>
          <option value="medium">Medium risk</option>
          <option value="low">On track</option>
        </select>
        <select value={close} onChange={(e) => setParam("close", e.target.value)} aria-label="Close date">
          <option value="">Any close date</option>
          <option value="quarter">Closing by end of {meta.currentPeriod.label}</option>
          <option value="30d">Next 30 days</option>
          <option value="overdue">Close date passed</option>
        </select>
        <select value={params.get("source") ?? ""} onChange={(e) => setParam("source", e.target.value)} aria-label="Source">
          <option value="">Any source</option>
          {meta.sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {view === "table" && (
          <select value={status} onChange={(e) => setParam("status", e.target.value)} aria-label="Status">
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="all">All</option>
          </select>
        )}
        {(activeFilters.length > 0 || params.get("owner")) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setParams(view === "table" ? { view: "table" } : {}, { replace: true })}>
            Clear filters
          </button>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : view === "board" ? (
        <Board deals={filtered} stages={meta.stages} onMove={moveTo} onOpen={(d) => nav(`/deals/${d.id}`)} />
      ) : (
        <DealTable deals={filtered} onOpen={(d) => nav(`/deals/${d.id}`)} />
      )}

      {lostFor && (
        <LostReasonModal
          dealName={lostFor.name}
          onCancel={() => setLostFor(null)}
          onConfirm={(reason) => {
            const d = lostFor;
            setLostFor(null);
            moveTo(d, meta.stages.find((s) => s.is_lost)!, reason);
          }}
        />
      )}
    </>
  );
}

function Board({ deals, stages, onMove, onOpen }: { deals: DealRow[]; stages: Stage[]; onMove: (d: DealRow, s: Stage) => void; onOpen: (d: DealRow) => void }) {
  const { today } = useMeta();
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const open = stages.filter(isOpen);
  const won = stages.find((s) => s.is_won)!;
  const lost = stages.find((s) => s.is_lost)!;
  const dragged = deals.find((d) => d.id === dragId);

  const dropProps = (stage: Stage) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(stage.id);
    },
    onDragLeave: () => setOver((o) => (o === stage.id ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      if (dragged) onMove(dragged, stage);
      setDragId(null);
    },
  });

  if (!deals.length) return <div className="card"><Empty title="No deals match these filters">Try clearing a filter, or create a new deal.</Empty></div>;

  return (
    <>
      <div className="board">
        {open.map((s) => {
          const ds = deals.filter((d) => d.stage_id === s.id).sort((a, b) => b.priority.score - a.priority.score);
          const sum = ds.reduce((a, d) => a + d.amount, 0);
          return (
            <div key={s.id} className={`col ${over === s.id ? "drop" : ""}`} {...dropProps(s)}>
              <div className="col-head">
                <div className="row-between">
                  <h3>{s.name}</h3>
                  <span className="badge">{ds.length}</span>
                </div>
                <div className="meta num">
                  {inrCompact(sum)} · {Math.round(s.probability * 100)}% → {inrCompact(sum * s.probability)} weighted
                </div>
              </div>
              <div className="col-body">
                {ds.map((d) => (
                  <div
                    key={d.id}
                    className={`deal-card risk-${d.risk.level} ${dragId === d.id ? "dragging" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      setDragId(d.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => onOpen(d)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(d)}
                  >
                    <div className="name">{d.name}</div>
                    <div className="acct">{d.account_name}</div>
                    <div className="foot">
                      <span className="amt">{inrCompact(d.amount)}</span>
                      <span className={`small ${d.expected_close_date < today ? "danger-text" : "muted"}`}>
                        <Icon.Clock size={12} /> {fmtShortDate(d.expected_close_date)}
                      </span>
                    </div>
                    <div className="foot" style={{ marginTop: 6 }}>
                      <span className="tiny muted ellipsis">{d.owner_name}</span>
                      {d.risk.level !== "low" ? <RiskBadge risk={d.risk} /> : d.forecast_category === "commit" ? <span className="badge b-brand">Commit</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="close-zones">
        <div className={`close-zone won ${over === won.id ? "drop" : ""}`} {...dropProps(won)}>
          <Icon.Check /> Drop here to mark as Won
        </div>
        <div className={`close-zone lost ${over === lost.id ? "drop" : ""}`} {...dropProps(lost)}>
          <Icon.X /> Drop here to mark as Lost
        </div>
      </div>
    </>
  );
}

function DealTable({ deals, onOpen }: { deals: DealRow[]; onOpen: (d: DealRow) => void }) {
  const { today } = useMeta();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "priority", dir: -1 });
  const sorted = useMemo(() => {
    const val = (d: DealRow) =>
      sort.key === "risk" ? d.risk.score : sort.key === "priority" ? d.priority.score : sort.key === "stage" ? d.stage_id : (d as any)[sort.key];
    return [...deals].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [deals, sort]);
  const th = (key: SortKey, label: string, cls = "") => (
    <th className={`sortable ${cls}`} onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : -1 })} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      {label} {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
    </th>
  );

  if (!deals.length) return <div className="card"><Empty title="No deals match these filters" /></div>;
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            {th("name", "Deal")}
            {th("stage", "Stage")}
            {th("amount", "Amount", "r")}
            {th("expected_close_date", "Close date")}
            <th>Owner</th>
            <th>Source</th>
            <th>Forecast</th>
            {th("risk", "Risk")}
            {th("priority", "Priority", "r")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => onOpen(d)}>
              <td>
                <Link to={`/deals/${d.id}`} className="cell-title" onClick={(e) => e.stopPropagation()}>
                  {d.name}
                </Link>
                <div className="cell-sub">{d.account_name}</div>
              </td>
              <td>{d.stage_name}</td>
              <td className="r strong">
                <Money value={d.amount} />
              </td>
              <td className={d.expected_close_date < today && !d.closed_at ? "danger-text" : ""}>{fmtDate(d.closed_at ?? d.expected_close_date)}</td>
              <td>{d.owner_name}</td>
              <td className="muted">{d.source || "—"}</td>
              <td>{CATEGORY_LABEL[d.forecast_category]}</td>
              <td>{d.closed_at ? <span className="muted small">{d.lost_reason ?? "Won"}</span> : <RiskBadge risk={d.risk} />}</td>
              <td className="r num">{d.closed_at ? "—" : d.priority.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
