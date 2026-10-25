import { useEffect, useState } from "react";
import type { Period } from "../../shared/dates.ts";
import { inr, inrCompact } from "../../shared/format.ts";
import { isOpen } from "../../shared/scoring.ts";
import { Card, ErrorState, Field, Loading, Modal, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";

const TABS = [
  { key: "stages", label: "Pipeline stages" },
  { key: "targets", label: "Targets" },
  { key: "team", label: "Team & access" },
  { key: "audit", label: "Audit log" },
  { key: "system", label: "Data & AI" },
] as const;

export function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("stages");
  const { isManager } = useApp();
  return (
    <>
      <PageHead title="Settings" subtitle={isManager ? "Configure how MNT Revenue measures your sales process." : "Read-only for salespeople. Ask your sales head to change these."} />
      <div className="tabs">
        {TABS.filter((t) => isManager || t.key !== "audit").map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "stages" && <Stages />}
      {tab === "targets" && <Targets />}
      {tab === "team" && <Team />}
      {tab === "audit" && <Audit />}
      {tab === "system" && <System />}
    </>
  );
}

function Stages() {
  const meta = useMeta();
  const { isManager, toast, refreshMeta } = useApp();
  const [rows, setRows] = useState(meta.stages.filter(isOpen).map((s) => ({ ...s })));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.put("/settings/stages", { stages: rows });
      await refreshMeta();
      toast("Stages saved. Weighted pipeline and risk scores now use the new values.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Stages, probabilities and expected durations"
      subtitle="Probability drives the weighted pipeline. Expected days drive the 'stalled' risk factor (flagged at 1.5× and 2×)."
      actions={
        isManager && (
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        )
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Stage name</th>
              <th>Win probability</th>
              <th>Expected days in stage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.id}>
                <td className="muted">{s.position}</td>
                <td>
                  <input value={s.name} disabled={!isManager} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} aria-label="Stage name" />
                </td>
                <td>
                  <div className="row">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(s.probability * 100)}
                      disabled={!isManager}
                      onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, probability: Number(e.target.value) / 100 } : r)))}
                      style={{ width: 80 }}
                      aria-label="Probability"
                    />
                    %
                  </div>
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={s.expected_days}
                    disabled={!isManager}
                    onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, expected_days: Number(e.target.value) } : r)))}
                    style={{ width: 80 }}
                    aria-label="Expected days"
                  />
                </td>
              </tr>
            ))}
            <tr>
              <td className="muted">—</td>
              <td colSpan={3} className="muted small">
                Closed Won (100%) and Closed Lost (0%) are fixed.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Targets() {
  const meta = useMeta();
  const { isManager, toast } = useApp();
  const { data, error, loading, reload } = useApi<{ periods: Period[]; current: string; targets: { user_id: number | null; period_key: string; amount: number }[] }>("/targets");
  const [edit, setEdit] = useState<{ userId: number | null; period: Period; amount: string } | null>(null);
  const sellers = meta.users.filter((u) => u.role !== "owner" && u.active);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  const val = (u: number | null, p: string) => data.targets.find((t) => t.user_id === u && t.period_key === p)?.amount ?? 0;

  async function save() {
    if (!edit) return;
    try {
      await api.put("/targets", { user_id: edit.userId, period_key: edit.period.key, amount: edit.amount.replace(/[,₹\s]/g, "") });
      toast("Target saved");
      setEdit(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const cell = (u: number | null, p: Period) => (
    <td key={p.key} className={`r num ${p.key === data.current ? "strong" : ""}`}>
      {isManager ? (
        <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ userId: u, period: p, amount: String(val(u, p.key)) })} title={inr(val(u, p.key))}>
          {val(u, p.key) ? inrCompact(val(u, p.key)) : "Set"}
        </button>
      ) : (
        inrCompact(val(u, p.key))
      )}
    </td>
  );

  return (
    <Card title="Quarterly revenue targets" subtitle="Indian financial year (April–March). Company target is set independently of individual targets.">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Target owner</th>
              {data.periods.map((p) => (
                <th key={p.key} className="r">
                  {p.label}
                  {p.key === data.current && " ●"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="cell-title">Company</td>
              {data.periods.map((p) => cell(null, p))}
            </tr>
            {sellers.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                {data.periods.map((p) => cell(u.id, p))}
              </tr>
            ))}
            <tr>
              <td className="muted small">Sum of individuals</td>
              {data.periods.map((p) => (
                <td key={p.key} className="r muted small num">
                  {inrCompact(sellers.reduce((s, u) => s + val(u.id, p.key), 0))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal
          title={`Target · ${edit.userId ? meta.users.find((u) => u.id === edit.userId)?.name : "Company"} · ${edit.period.label}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save}>
                Save target
              </button>
            </>
          }
        >
          <Field label="Amount (₹)" hint={Number(edit.amount.replace(/[,₹\s]/g, "")) ? inr(Number(edit.amount.replace(/[,₹\s]/g, ""))) : undefined}>
            <input value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} autoFocus inputMode="numeric" onKeyDown={(e) => e.key === "Enter" && save()} />
          </Field>
        </Modal>
      )}
    </Card>
  );
}

function Team() {
  const meta = useMeta();
  const { user, toast, refreshMeta } = useApp();
  const isOwner = user!.role === "owner";
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", email: "", title: "", role: "rep", password: "", team_id: "" });
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    try {
      await api.post("/users", { ...f, team_id: f.team_id || null });
      toast(`${f.name} added`);
      setAdding(false);
      setF({ name: "", email: "", title: "", role: "rep", password: "", team_id: "" });
      refreshMeta();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggle(id: number, active: boolean) {
    try {
      await api.patch(`/users/${id}`, { active });
      toast(active ? "User reactivated" : "User deactivated and signed out");
      refreshMeta();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const ROLE = { owner: "Owner / CEO", manager: "Sales head", rep: "Salesperson" } as const;

  return (
    <Card
      title="Team & access"
      subtitle="Owners and sales heads see the whole organisation. Salespeople see and edit only their own deals and follow-ups."
      actions={
        isOwner && (
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            Add user
          </button>
        )
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Team</th>
              <th>Status</th>
              {isOwner && <th />}
            </tr>
          </thead>
          <tbody>
            {meta.users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="cell-title">{u.name}</div>
                  <div className="cell-sub">{u.title}</div>
                </td>
                <td className="muted">{u.email}</td>
                <td>{ROLE[u.role]}</td>
                <td>{meta.teams.find((t) => t.id === u.team_id)?.name ?? "—"}</td>
                <td>{u.active ? <span className="badge b-ok">Active</span> : <span className="badge">Inactive</span>}</td>
                {isOwner && (
                  <td className="r">
                    {u.id !== user!.id && (
                      <button className="btn btn-sm" onClick={() => toggle(u.id, !u.active)}>
                        {u.active ? "Deactivate" : "Reactivate"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <Modal
          title="Add user"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={add}>
                Add user
              </button>
            </>
          }
        >
          <div className="form-grid">
            {error && <div className="error-box full">{error}</div>}
            <Field label="Full name">
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Work email">
              <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <Field label="Job title">
              <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <Field label="Role">
              <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                <option value="rep">Salesperson</option>
                <option value="manager">Sales head</option>
                <option value="owner">Owner / CEO</option>
              </select>
            </Field>
            <Field label="Team">
              <select value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })}>
                <option value="">—</option>
                {meta.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Initial password" hint="At least 8 characters">
              <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function Audit() {
  const { data, error, loading, reload } = useApi<{ id: number; user_name: string | null; entity: string; entity_id: number | null; action: string; detail: string; at: string }[]>("/audit");
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  return (
    <Card title="Audit log" subtitle="Last 150 changes made in this organisation">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Who</th>
              <th>What</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No changes recorded yet.
                </td>
              </tr>
            ) : (
              data.map((l) => (
                <tr key={l.id}>
                  <td className="small muted num">{l.at}</td>
                  <td>{l.user_name ?? "System"}</td>
                  <td>
                    {l.entity}
                    {l.entity_id ? ` #${l.entity_id}` : ""} · {l.action.replace("_", " ")}
                  </td>
                  <td className="small muted">{l.detail}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function System() {
  const meta = useMeta();
  const { user, toast, signOut } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [health, setHealth] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => setHealth(r.ok))
      .catch(() => setHealth(false));
  }, []);

  async function reset() {
    try {
      await api.post("/demo/reset");
      toast("Demo data regenerated. Please sign in again.");
      setTimeout(signOut, 800);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="grid g-2">
      <Card title="Intelligence engine" pad>
        <div className="stack-sm small">
          <div className="row-between">
            <span>Risk & priority scoring</span>
            <span className="badge b-ok">Rule-based · active</span>
          </div>
          <div className="row-between">
            <span>Insights & recommendations</span>
            <span className="badge b-ok">Rule-based · active</span>
          </div>
          <div className="row-between">
            <span>Email drafts</span>
            <span className="badge b-ok">Template · active</span>
          </div>
          <div className="row-between">
            <span>Language model (optional)</span>
            <span className={`badge ${meta.ai.engine === "rules" ? "" : "b-info"}`}>{meta.ai.engine === "rules" ? "Not configured" : meta.ai.model}</span>
          </div>
          <p className="muted mt-sm">
            {meta.ai.label}. Set <code>OLLAMA_URL</code> (and optionally <code>OLLAMA_MODEL</code>) before starting the server to let a local model reword the briefing. Any output that changes a figure is rejected and the rule-based
            text is used instead. Money totals, forecasts and scores are always computed by code.
          </p>
        </div>
      </Card>
      <Card title="Data" pad>
        <div className="stack-sm small">
          <div className="row-between">
            <span>Organisation</span>
            <b>{meta.org.name}</b>
          </div>
          <div className="row-between">
            <span>Currency · financial year</span>
            <b>
              {meta.org.currency} · starts {new Date(2000, meta.org.fy_start_month - 1, 1).toLocaleDateString("en-IN", { month: "long" })}
            </b>
          </div>
          <div className="row-between">
            <span>Storage</span>
            <b>Local SQLite file (data/mnt-revenue.db)</b>
          </div>
          <div className="row-between">
            <span>API health</span>
            <span className={`badge ${health ? "b-ok" : health === false ? "b-high" : ""}`}>{health === null ? "Checking…" : health ? "Healthy" : "Unreachable"}</span>
          </div>
          <p className="muted mt-sm">All companies, people and figures in the demo dataset are fictional and generated relative to today’s date.</p>
          {user!.role === "owner" && (
            <div className="mt-sm">
              {!confirming ? (
                <button className="btn btn-danger" onClick={() => setConfirming(true)}>
                  Reset demo data…
                </button>
              ) : (
                <div className="notice warn">
                  <div>
                    This deletes every deal, account, activity, user and target — including anything you imported — and regenerates the demo dataset.
                    <div className="row mt-sm">
                      <button className="btn btn-sm" onClick={() => setConfirming(false)}>
                        Cancel
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={reset}>
                        Yes, reset everything
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
