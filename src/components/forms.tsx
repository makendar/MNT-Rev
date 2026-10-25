import { useState } from "react";
import { addDays } from "../../shared/dates.ts";
import { api } from "../lib/api";
import { useApp, useMeta } from "../state";
import { Field, Modal } from "./ui";

export function LostReasonModal({ dealName, onCancel, onConfirm }: { dealName: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const meta = useMeta();
  const [reason, setReason] = useState(meta.lostReasons[0]);
  return (
    <Modal
      title="Close deal as lost"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onConfirm(reason)}>
            Mark as lost
          </button>
        </>
      }
    >
      <div className="stack">
        <p>
          Why was <b>{dealName}</b> lost? Loss reasons feed the win/loss analysis, so pick the closest match.
        </p>
        <div className="stack-sm">
          {meta.lostReasons.map((r) => (
            <label key={r} className="row" style={{ cursor: "pointer" }}>
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} style={{ height: 16 }} />
              {r}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function ActivityForm({ dealId, accountId, onClose, onSaved }: { dealId?: number; accountId?: number; onClose: () => void; onSaved: () => void }) {
  const meta = useMeta();
  const { toast } = useApp();
  const [f, setF] = useState({ type: "call", subject: "", notes: "", outcome: "Positive", occurred_at: meta.today, followUp: true, fuTitle: "", fuDate: addDays(meta.today, 3) });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/activities", {
        deal_id: dealId,
        account_id: accountId,
        type: f.type,
        subject: f.subject,
        notes: f.notes,
        outcome: f.outcome,
        occurred_at: f.occurred_at,
        follow_up: f.followUp && f.fuTitle ? { title: f.fuTitle, due_date: f.fuDate } : undefined,
      });
      toast(f.followUp && f.fuTitle ? "Activity logged and follow-up scheduled" : "Activity logged");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Log activity"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Log activity"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {error && <div className="error-box full">{error}</div>}
        <Field label="Type">
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="demo">Demo</option>
            <option value="note">Note</option>
          </select>
        </Field>
        <Field label="Date">
          <input type="date" value={f.occurred_at} max={meta.today} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} />
        </Field>
        <Field label="Subject" full>
          <input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Pricing discussion with CFO" autoFocus />
        </Field>
        <Field label="Outcome">
          <select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
            <option>Positive</option>
            <option>Neutral</option>
            <option>Needs follow-up</option>
            <option>Negative</option>
          </select>
        </Field>
        <div />
        <Field label="Notes" full>
          <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What was discussed, objections, commitments…" />
        </Field>
        <label className="row full" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={f.followUp} onChange={(e) => setF({ ...f, followUp: e.target.checked })} />
          Schedule a follow-up
        </label>
        {f.followUp && (
          <>
            <Field label="Follow-up">
              <input value={f.fuTitle} onChange={(e) => setF({ ...f, fuTitle: e.target.value })} placeholder="e.g. Send revised proposal" />
            </Field>
            <Field label="Due">
              <input type="date" value={f.fuDate} onChange={(e) => setF({ ...f, fuDate: e.target.value })} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

export function TaskForm({ dealId, onClose, onSaved }: { dealId?: number; onClose: () => void; onSaved: () => void }) {
  const meta = useMeta();
  const { user, isManager, toast } = useApp();
  const [f, setF] = useState({ title: "", due_date: addDays(meta.today, 1), priority: "medium", assigned_to: String(user!.id), type: "follow_up" });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await api.post("/tasks", { ...f, deal_id: dealId, assigned_to: Number(f.assigned_to) });
      toast("Follow-up added");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal
      title="New follow-up"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Add follow-up
          </button>
        </>
      }
    >
      <div className="form-grid">
        {error && <div className="error-box full">{error}</div>}
        <Field label="What needs to happen" full>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Call to confirm decision timeline" autoFocus />
        </Field>
        <Field label="Due date">
          <input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </Field>
        <Field label="Priority">
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Type">
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="follow_up">Follow-up</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
          </select>
        </Field>
        {isManager && (
          <Field label="Assign to">
            <select value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}>
              {meta.users.filter((u) => u.active).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
