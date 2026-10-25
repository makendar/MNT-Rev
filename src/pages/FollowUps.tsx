import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addDays } from "../../shared/dates.ts";
import { fmtDate, fmtShortDate } from "../../shared/format.ts";
import type { Task } from "../../shared/types.ts";
import { TaskForm } from "../components/forms";
import { Icon } from "../components/icons";
import { Empty, ErrorState, Loading, Money, PageHead } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";

type Row = Task & { deal_name: string | null; account_name: string | null; assignee_name: string; deal_amount: number | null };
const VIEWS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Completed (14 days)" },
] as const;

export function FollowUps() {
  const meta = useMeta();
  const { isManager, viewAs, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "overdue";
  const assignee = params.get("assignee") ?? (viewAs ? String(viewAs) : "");
  const { data, error, loading, reload, setData } = useApi<{ tasks: Row[]; counts: Record<string, number> }>(`/tasks${qs({ view, assignee })}`);
  const [adding, setAdding] = useState(false);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  async function update(t: Row, body: Record<string, unknown>, msg: string) {
    if ("status" in body) setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, status: body.status as Row["status"] } : x)) });
    try {
      await api.patch(`/tasks/${t.id}`, body);
      toast(msg);
    } catch (e) {
      toast((e as Error).message, "error");
    }
    reload();
  }

  return (
    <>
      <PageHead title="Follow-ups" subtitle="Disciplined follow-up is the cheapest way to protect pipeline.">
        {isManager && (
          <select value={assignee} onChange={(e) => set("assignee", e.target.value)} aria-label="Assignee">
            <option value="">Everyone</option>
            {meta.users.filter((u) => u.active).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon.Plus /> New follow-up
        </button>
      </PageHead>

      <div className="tabs">
        {VIEWS.map((v) => (
          <button key={v.key} className={`tab ${view === v.key ? "active" : ""}`} onClick={() => set("view", v.key)}>
            {v.label}
            {data?.counts && <span className="count">{data.counts[v.key] ?? 0}</span>}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !data?.tasks.length ? (
        <div className="card">
          <Empty title={view === "overdue" ? "Nothing overdue" : "Nothing here"}>{view === "overdue" ? "Great discipline — every follow-up is on time." : "No follow-ups in this view."}</Empty>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Follow-up</th>
                <th>Deal</th>
                <th className="r">Deal value</th>
                <th>Assignee</th>
                <th>Priority</th>
                <th>{view === "done" ? "Completed" : "Due"}</th>
                {view !== "done" && <th className="r">Reschedule</th>}
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.status === "done"}
                      onChange={() => update(t, { status: t.status === "done" ? "open" : "done" }, t.status === "done" ? "Reopened" : "Follow-up completed")}
                      aria-label={`Complete ${t.title}`}
                    />
                  </td>
                  <td>
                    <div className="cell-title">{t.title}</div>
                    <div className="cell-sub">{t.type.replace("_", " ")}</div>
                  </td>
                  <td>
                    {t.deal_id ? (
                      <>
                        <Link to={`/deals/${t.deal_id}`}>{t.deal_name}</Link>
                        <div className="cell-sub">{t.account_name}</div>
                      </>
                    ) : (
                      <span className="muted">General</span>
                    )}
                  </td>
                  <td className="r">{t.deal_amount ? <Money value={t.deal_amount} /> : "—"}</td>
                  <td>{t.assignee_name}</td>
                  <td>
                    <span className={`badge b-${t.priority === "high" ? "high" : t.priority === "medium" ? "medium" : "info"}`}>{t.priority}</span>
                  </td>
                  <td className={t.status === "open" && t.due_date < meta.today ? "danger-text strong" : ""}>
                    {view === "done" ? fmtDate(t.completed_at) : t.due_date === meta.today ? "Today" : fmtShortDate(t.due_date)}
                  </td>
                  {view !== "done" && (
                    <td className="r">
                      <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                        {[1, 3, 7].map((n) => (
                          <button key={n} className="btn btn-sm" onClick={() => update(t, { due_date: addDays(meta.today, n) }, `Moved to ${fmtShortDate(addDays(meta.today, n))}`)}>
                            +{n}d
                          </button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <TaskForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
    </>
  );
}
