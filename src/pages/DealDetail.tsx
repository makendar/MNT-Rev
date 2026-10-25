import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { daysBetween } from "../../shared/dates.ts";
import { fmtDate, fmtShortDate } from "../../shared/format.ts";
import { isOpen } from "../../shared/scoring.ts";
import type { Activity, Contact, DealRow, Stage, Task } from "../../shared/types.ts";
import { DealForm } from "../components/DealForm";
import { ActivityForm, LostReasonModal, TaskForm } from "../components/forms";
import { Icon } from "../components/icons";
import { ACTIVITY_ICON, CATEGORY_LABEL, Card, Empty, ErrorState, Loading, Money, RiskBadge, ScoreRing } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";

interface DealDetailData {
  deal: DealRow;
  stage: Stage;
  account: { id: number; name: string; industry: string; city: string; size: string; website: string };
  contacts: Contact[];
  activities: Activity[];
  tasks: (Task & { assignee_name: string })[];
  history: { changed_at: string; from_stage: string | null; to_stage: string; changed_by: string }[];
  recommendations: string[];
  emailDraft: { subject: string; body: string; note: string } | null;
}

export function DealDetail() {
  const { id } = useParams();
  const meta = useMeta();
  const { isManager, toast } = useApp();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi<DealDetailData>(`/deals/${id}`);
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [askLost, setAskLost] = useState(false);
  const [tab, setTab] = useState<"activity" | "history">("activity");

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { deal, stage } = data;
  const open = isOpen(stage);
  const openStages = meta.stages.filter(isOpen);
  const won = meta.stages.find((s) => s.is_won)!;
  const lost = meta.stages.find((s) => s.is_lost)!;
  const contact = data.contacts.find((c) => c.id === deal.contact_id);

  async function setStage(s: Stage, lostReason?: string) {
    if (s.id === deal.stage_id) return;
    if (s.is_lost && !lostReason) return setAskLost(true);
    try {
      await api.patch(`/deals/${deal.id}`, { stage_id: s.id, lost_reason: lostReason });
      toast(`Moved to ${s.name}`);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function patch(body: Record<string, unknown>, msg: string) {
    try {
      await api.patch(`/deals/${deal.id}`, body);
      toast(msg);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function toggleTask(t: Task) {
    await api.patch(`/tasks/${t.id}`, { status: t.status === "open" ? "done" : "open" });
    reload();
  }

  async function remove() {
    if (!confirm(`Delete “${deal.name}”? This removes its activities and follow-ups and cannot be undone.`)) return;
    await api.del(`/deals/${deal.id}`);
    toast("Deal deleted");
    nav("/pipeline");
  }

  return (
    <>
      <div className="small muted mb" style={{ marginBottom: 10 }}>
        <Link to="/pipeline">Pipeline</Link> / <Link to={`/accounts/${data.account.id}`}>{data.account.name}</Link>
      </div>
      <div className="card card-pad mb">
        <div className="row-between wrap" style={{ alignItems: "flex-start" }}>
          <div>
            <h1>{deal.name}</h1>
            <div className="muted mt-sm row wrap" style={{ gap: 12 }}>
              <span>
                <Icon.Building size={13} /> <Link to={`/accounts/${data.account.id}`}>{data.account.name}</Link>
              </span>
              <span>Owner: {deal.owner_name}</span>
              <span>Source: {deal.source || "—"}</span>
              <span>{deal.product_line}</span>
            </div>
          </div>
          <div className="row wrap">
            <div style={{ textAlign: "right", marginRight: 10 }}>
              <div style={{ fontSize: 26, fontWeight: 600 }}>
                <Money value={deal.amount} />
              </div>
              <div className="small muted">
                {open ? `Closes ${fmtDate(deal.expected_close_date)}` : `Closed ${fmtDate(deal.closed_at)}`}
              </div>
            </div>
            <button className="btn" onClick={() => setLogging(true)}>
              <Icon.Phone /> Log activity
            </button>
            <button className="btn" onClick={() => setEditing(true)}>
              <Icon.Edit /> Edit
            </button>
            {isManager && (
              <button className="btn btn-ghost btn-icon btn-danger" onClick={remove} title="Delete deal" aria-label="Delete deal">
                <Icon.Trash />
              </button>
            )}
          </div>
        </div>
        <div className="stepper" role="group" aria-label="Stage">
          {openStages.map((s) => (
            <button
              key={s.id}
              className={`step ${stage.is_won ? "done" : s.id === stage.id ? "current" : s.position < stage.position && open ? "done" : ""}`}
              onClick={() => setStage(s)}
              title={`Move to ${s.name}`}
            >
              {s.name}
            </button>
          ))}
          <button className={`step ${stage.is_won ? "won" : ""}`} onClick={() => setStage(won)}>
            Won
          </button>
          <button className={`step ${stage.is_lost ? "lost" : ""}`} onClick={() => setStage(lost)}>
            Lost
          </button>
        </div>
        {!open && (
          <div className={`notice mt ${stage.is_lost ? "warn" : ""}`}>
            {stage.is_won ? "This deal is closed won." : `Closed lost — reason: ${deal.lost_reason ?? "not recorded"}.`} Click an open stage above to reopen it.
          </div>
        )}
      </div>

      <div className="grid g-main-side">
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Deal details" pad>
            <dl className="kv">
              <dt>Stage</dt>
              <dd>
                {stage.name} · {Math.round(stage.probability * 100)}% probability · {daysBetween(deal.stage_entered_at.slice(0, 10), meta.today)} days in stage
              </dd>
              <dt>Forecast category</dt>
              <dd>
                {open ? (
                  <select value={deal.forecast_category} onChange={(e) => patch({ forecast_category: e.target.value }, "Forecast category updated")} style={{ height: 28 }}>
                    {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  CATEGORY_LABEL[deal.forecast_category]
                )}
              </dd>
              <dt>Primary contact</dt>
              <dd>
                {contact ? (
                  <>
                    {contact.name} · {contact.title} {contact.is_decision_maker ? <span className="badge b-brand">Decision-maker</span> : null}
                    <div className="small muted">
                      {contact.email} · {contact.phone}
                    </div>
                  </>
                ) : (
                  <span className="muted">None set</span>
                )}
              </dd>
              <dt>Next step</dt>
              <dd>
                {deal.next_step ? (
                  <>
                    {deal.next_step}
                    {deal.next_step_date && <span className={deal.next_step_date < meta.today ? "danger-text" : "muted"}> · {fmtShortDate(deal.next_step_date)}</span>}
                  </>
                ) : (
                  <span className="warn-text">No next step recorded</span>
                )}
              </dd>
              <dt>Created</dt>
              <dd>
                {fmtDate(deal.created_at)} · {daysBetween(deal.created_at, meta.today)} days old
              </dd>
              <dt>Close date changes</dt>
              <dd>{deal.close_date_pushes ? `Pushed out ${deal.close_date_pushes} time${deal.close_date_pushes > 1 ? "s" : ""}` : "None"}</dd>
              {deal.notes && (
                <>
                  <dt>Notes</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{deal.notes}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card
            title="Follow-ups"
            actions={
              <button className="btn btn-sm" onClick={() => setAddingTask(true)}>
                <Icon.Plus /> Add
              </button>
            }
          >
            {data.tasks.length === 0 ? (
              <Empty title="No follow-ups">Add one so this deal doesn't go quiet.</Empty>
            ) : (
              data.tasks.map((t) => (
                <div key={t.id} className="list-item">
                  <input type="checkbox" checked={t.status === "done"} onChange={() => toggleTask(t)} aria-label={`Toggle ${t.title}`} />
                  <div className="grow">
                    <div className={`small strong ${t.status === "done" ? "faint" : ""}`} style={t.status === "done" ? { textDecoration: "line-through" } : undefined}>
                      {t.title}
                    </div>
                    <div className="tiny muted">
                      {t.assignee_name} · {t.priority} priority
                    </div>
                  </div>
                  {t.status === "open" && (
                    <span className={`badge ${t.due_date < meta.today ? "b-high" : t.due_date === meta.today ? "b-medium" : ""}`}>
                      {t.due_date < meta.today ? "Overdue · " : ""}
                      {fmtShortDate(t.due_date)}
                    </span>
                  )}
                </div>
              ))
            )}
          </Card>

          <section className="card">
            <div className="card-head" style={{ paddingBottom: 0, borderBottom: "none" }}>
              <div className="tabs" style={{ marginBottom: 0, flex: 1 }}>
                <button className={`tab ${tab === "activity" ? "active" : ""}`} onClick={() => setTab("activity")}>
                  Activity <span className="count">{data.activities.length}</span>
                </button>
                <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
                  Stage history <span className="count">{data.history.length}</span>
                </button>
              </div>
            </div>
            <div className="card-body">
              {tab === "activity" ? (
                data.activities.length === 0 ? (
                  <Empty title="No activity yet">Log your first call, email or meeting.</Empty>
                ) : (
                  <div className="timeline">
                    {data.activities.map((a) => {
                      const I = ACTIVITY_ICON[a.type] ?? Icon.Note;
                      return (
                        <div key={a.id} className="tl-item">
                          <div className="tl-icon">
                            <I size={14} />
                          </div>
                          <div>
                            <div className="row-between">
                              <span className="strong small">{a.subject}</span>
                              <span className="tiny muted">{fmtDate(a.occurred_at)}</span>
                            </div>
                            <div className="tiny muted">
                              {a.type} · {a.user_name}
                              {a.outcome && ` · ${a.outcome}`}
                            </div>
                            {a.notes && <p className="small mt-sm">{a.notes}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="timeline">
                  {data.history.map((h, i) => (
                    <div key={i} className="tl-item">
                      <div className="tl-icon">
                        <Icon.Arrow size={14} />
                      </div>
                      <div className="row-between">
                        <span className="small">
                          {h.from_stage ? `${h.from_stage} → ` : "Created in "}
                          <b>{h.to_stage}</b>
                          {h.changed_by && <span className="muted"> · {h.changed_by}</span>}
                        </span>
                        <span className="tiny muted">{fmtDate(h.changed_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {open && (
            <Card title="Deal health" subtitle="Rule-based score. Each point is explained below.">
              <div className="card-body">
                <div className="row" style={{ gap: 16 }}>
                  <div className="stack-sm" style={{ alignItems: "center" }}>
                    <ScoreRing score={deal.risk.score} kind="risk" />
                    <span className="tiny muted">Risk</span>
                  </div>
                  <div className="stack-sm" style={{ alignItems: "center" }}>
                    <ScoreRing score={deal.priority.score} kind="priority" />
                    <span className="tiny muted">Priority</span>
                  </div>
                  <div>
                    <RiskBadge risk={deal.risk} />
                    {deal.priority.reasons.length > 0 && <div className="small muted mt-sm">{deal.priority.reasons.join(" · ")}</div>}
                  </div>
                </div>
                <div className="mt">
                  {deal.risk.factors.length === 0 ? (
                    <p className="small ok-text">No risk factors detected.</p>
                  ) : (
                    deal.risk.factors.map((f) => (
                      <div key={f.code} className="factor">
                        <span className="pts">+{f.points}</span>
                        <div>
                          <div className="small strong">{f.label}</div>
                          <div className="tiny muted">{f.detail}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>
          )}
          {data.recommendations.length > 0 && (
            <Card title="Recommended next actions" subtitle="Derived from this deal's risk factors">
              <div className="card-body">
                {data.recommendations.map((r, i) => (
                  <div key={i} className="reco">
                    <span className="n">{i + 1}</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {data.emailDraft && (
            <Card
              title="Follow-up email draft"
              subtitle={data.emailDraft.note}
              actions={
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(`Subject: ${data.emailDraft!.subject}\n\n${data.emailDraft!.body}`);
                    toast("Draft copied to clipboard");
                  }}
                >
                  <Icon.Copy /> Copy
                </button>
              }
            >
              <div className="card-body">
                <div className="small strong mb" style={{ marginBottom: 8 }}>
                  Subject: {data.emailDraft.subject}
                </div>
                <div className="email-draft">{data.emailDraft.body}</div>
              </div>
            </Card>
          )}
          <Card title="Stakeholders" subtitle={`${data.contacts.length} contacts at ${data.account.name}`}>
            {data.contacts.map((c) => (
              <div key={c.id} className="list-item">
                <div className="grow">
                  <div className="small strong">
                    {c.name} {c.id === deal.contact_id && <span className="badge b-brand">Primary</span>}
                  </div>
                  <div className="tiny muted">{c.title}</div>
                </div>
                {c.is_decision_maker ? <span className="badge b-opportunity">Decision-maker</span> : null}
                {c.id !== deal.contact_id && open && (
                  <button className="btn btn-sm btn-ghost" onClick={() => patch({ contact_id: c.id }, `${c.name} set as primary contact`)}>
                    Make primary
                  </button>
                )}
              </div>
            ))}
          </Card>
        </div>
      </div>

      {editing && (
        <DealForm
          deal={deal}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {logging && (
        <ActivityForm
          dealId={deal.id}
          onClose={() => setLogging(false)}
          onSaved={() => {
            setLogging(false);
            reload();
          }}
        />
      )}
      {addingTask && (
        <TaskForm
          dealId={deal.id}
          onClose={() => setAddingTask(false)}
          onSaved={() => {
            setAddingTask(false);
            reload();
          }}
        />
      )}
      {askLost && (
        <LostReasonModal
          dealName={deal.name}
          onCancel={() => setAskLost(false)}
          onConfirm={(r) => {
            setAskLost(false);
            setStage(lost, r);
          }}
        />
      )}
    </>
  );
}
