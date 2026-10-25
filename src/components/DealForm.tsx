import { useEffect, useMemo, useState } from "react";
import { addDays } from "../../shared/dates.ts";
import { inr } from "../../shared/format.ts";
import { isOpen } from "../../shared/scoring.ts";
import type { Contact, Deal } from "../../shared/types.ts";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";
import { Field, Modal } from "./ui";

interface Props {
  deal?: Deal;
  defaultAccountId?: number;
  onClose: () => void;
  onSaved: (id: number) => void;
}

export function DealForm({ deal, defaultAccountId, onClose, onSaved }: Props) {
  const meta = useMeta();
  const { user, isManager, toast } = useApp();
  const accounts = useApi<{ id: number; name: string }[]>("/accounts");
  const openStages = meta.stages.filter(isOpen);
  const [f, setF] = useState({
    name: deal?.name ?? "",
    account: "",
    contact_id: deal?.contact_id ? String(deal.contact_id) : "",
    amount: deal ? String(deal.amount) : "",
    expected_close_date: deal?.expected_close_date ?? addDays(meta.today, 60),
    stage_id: String(deal?.stage_id ?? openStages[0].id),
    owner_id: String(deal?.owner_id ?? user!.id),
    source: deal?.source ?? "",
    product_line: deal?.product_line ?? "",
    forecast_category: deal?.forecast_category ?? "pipeline",
    next_step: deal?.next_step ?? "",
    next_step_date: deal?.next_step_date ?? "",
    notes: deal?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!accounts.data || f.account) return;
    const id = deal?.account_id ?? defaultAccountId;
    const a = accounts.data.find((x) => x.id === id);
    if (a) setF((s) => ({ ...s, account: a.name }));
  }, [accounts.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const matchedAccount = useMemo(() => accounts.data?.find((a) => a.name.toLowerCase() === f.account.trim().toLowerCase()), [accounts.data, f.account]);
  const contacts = useApi<{ contacts: Contact[] }>(matchedAccount ? `/accounts/${matchedAccount.id}` : null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: f.name,
        amount: f.amount,
        expected_close_date: f.expected_close_date,
        source: f.source,
        product_line: f.product_line,
        forecast_category: f.forecast_category,
        next_step: f.next_step,
        next_step_date: f.next_step_date || null,
        notes: f.notes,
        contact_id: f.contact_id || null,
      };
      if (isManager) body.owner_id = Number(f.owner_id);
      if (deal) {
        if (Number(f.stage_id) !== deal.stage_id) body.stage_id = Number(f.stage_id);
        await api.patch(`/deals/${deal.id}`, body);
        toast("Deal updated");
        onSaved(deal.id);
      } else {
        if (!f.account.trim()) throw new Error("Account is required");
        if (matchedAccount) body.account_id = matchedAccount.id;
        else body.account_name = f.account.trim();
        body.stage_id = Number(f.stage_id);
        const res = await api.post<{ id: number }>("/deals", body);
        toast(matchedAccount ? "Deal created" : `Deal created with new account “${f.account.trim()}”`);
        onSaved(res.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={deal ? "Edit deal" : "New deal"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : deal ? "Save changes" : "Create deal"}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {error && <div className="error-box full">{error}</div>}
        <Field label="Deal name" full>
          <input value={f.name} onChange={set("name")} placeholder="e.g. Kaveri Logistics – Cloud migration" autoFocus required />
        </Field>
        <Field label="Account" hint={!deal && f.account && !matchedAccount ? "A new account will be created" : undefined}>
          <input value={f.account} onChange={set("account")} list="acct-list" disabled={!!deal} placeholder="Start typing a company name" />
          <datalist id="acct-list">{accounts.data?.map((a) => <option key={a.id} value={a.name} />)}</datalist>
        </Field>
        <Field label="Primary contact">
          <select value={f.contact_id} onChange={set("contact_id")} disabled={!matchedAccount}>
            <option value="">— None —</option>
            {contacts.data?.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.title}
                {c.is_decision_maker ? " ★" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (₹)" hint={Number(f.amount) > 0 ? inr(Number(f.amount)) : "Plain number, e.g. 2500000"}>
          <input value={f.amount} onChange={set("amount")} inputMode="numeric" placeholder="2500000" required />
        </Field>
        <Field label="Expected close date">
          <input type="date" value={f.expected_close_date} onChange={set("expected_close_date")} required />
        </Field>
        <Field label="Stage">
          <select value={f.stage_id} onChange={set("stage_id")}>
            {(deal ? meta.stages.filter((s) => !s.is_lost) : openStages).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({Math.round(s.probability * 100)}%)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Forecast category" hint="Your judgement of whether this closes in its period">
          <select value={f.forecast_category} onChange={set("forecast_category")}>
            <option value="pipeline">Pipeline</option>
            <option value="best_case">Best case</option>
            <option value="commit">Commit</option>
            <option value="omitted">Omitted</option>
          </select>
        </Field>
        {isManager && (
          <Field label="Owner">
            <select value={f.owner_id} onChange={set("owner_id")}>
              {meta.users.filter((u) => u.active).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Lead source">
          <select value={f.source} onChange={set("source")}>
            <option value="">— Not set —</option>
            {meta.sources.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Product / service line">
          <input value={f.product_line} onChange={set("product_line")} list="pl-list" />
          <datalist id="pl-list">{meta.productLines.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Next step">
          <input value={f.next_step} onChange={set("next_step")} placeholder="e.g. Send revised proposal" />
        </Field>
        <Field label="Next step date">
          <input type="date" value={f.next_step_date} onChange={set("next_step_date")} />
        </Field>
        <Field label="Notes" full>
          <textarea value={f.notes} onChange={set("notes")} rows={3} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
