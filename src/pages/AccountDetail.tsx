import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fmtDate, fmtShortDate } from "../../shared/format.ts";
import type { Activity, Contact, DealRow } from "../../shared/types.ts";
import { DealForm } from "../components/DealForm";
import { ActivityForm } from "../components/forms";
import { Icon } from "../components/icons";
import { ACTIVITY_ICON, Card, Empty, ErrorState, Field, Kpi, Loading, Modal, Money, RiskBadge } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp } from "../state";
import { AccountForm } from "./Accounts";

interface Data {
  account: { id: number; name: string; industry: string; city: string; size: string; website: string; owner_name: string; created_at: string };
  contacts: Contact[];
  deals: DealRow[];
  activities: (Activity & { deal_name: string | null })[];
}

export function AccountDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<Data>(`/accounts/${id}`);
  const [modal, setModal] = useState<"edit" | "deal" | "contact" | "activity" | null>(null);
  const [editContact, setEditContact] = useState<Contact | null>(null);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { account, deals } = data;
  const open = deals.filter((d) => !d.closed_at);
  const won = deals.filter((d) => d.closed_at && !d.lost_reason);
  const lost = deals.filter((d) => d.lost_reason);
  const close = () => {
    setModal(null);
    setEditContact(null);
  };
  const saved = () => {
    close();
    reload();
  };

  return (
    <>
      <div className="small muted" style={{ marginBottom: 10 }}>
        <Link to="/accounts">Accounts</Link> / {account.name}
      </div>
      <div className="page-head">
        <div>
          <h1>{account.name}</h1>
          <p>
            {[account.industry, account.city, account.size && `${account.size} employees`, account.website].filter(Boolean).join(" · ")} · Owner {account.owner_name}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setModal("activity")}>
            <Icon.Phone /> Log activity
          </button>
          <button className="btn" onClick={() => setModal("edit")}>
            <Icon.Edit /> Edit
          </button>
          <button className="btn btn-primary" onClick={() => setModal("deal")}>
            <Icon.Plus /> New deal
          </button>
        </div>
      </div>

      <div className="grid g-4 mb">
        <Kpi label="Open pipeline" value={<Money value={open.reduce((s, d) => s + d.amount, 0)} />} sub={`${open.length} open deals`} />
        <Kpi label="Won to date" value={<Money value={won.reduce((s, d) => s + d.amount, 0)} />} sub={`${won.length} deals won`} />
        <Kpi label="Win rate" value={won.length + lost.length ? `${Math.round((won.length / (won.length + lost.length)) * 100)}%` : "—"} sub={`${lost.length} lost`} />
        <Kpi label="Contacts" value={data.contacts.length} sub={`${data.contacts.filter((c) => c.is_decision_maker).length} decision-makers`} />
      </div>

      <div className="grid g-main-side">
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Deals">
            {deals.length === 0 ? (
              <Empty title="No deals yet" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Deal</th>
                      <th>Stage</th>
                      <th className="r">Amount</th>
                      <th>Close</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <Link to={`/deals/${d.id}`} className="cell-title">
                            {d.name}
                          </Link>
                          <div className="cell-sub">{d.owner_name}</div>
                        </td>
                        <td>{d.stage_name}</td>
                        <td className="r strong">
                          <Money value={d.amount} />
                        </td>
                        <td>{fmtShortDate(d.closed_at ?? d.expected_close_date)}</td>
                        <td>{d.closed_at ? <span className="muted small">{d.lost_reason ? `Lost · ${d.lost_reason}` : "Won"}</span> : <RiskBadge risk={d.risk} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Recent activity">
            <div className="card-body">
              {data.activities.length === 0 ? (
                <Empty title="No activity" />
              ) : (
                data.activities.map((a) => {
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
                          {a.user_name}
                          {a.deal_name && ` · ${a.deal_name}`}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
        <Card
          title="Contacts"
          actions={
            <button className="btn btn-sm" onClick={() => setModal("contact")}>
              <Icon.Plus /> Add
            </button>
          }
        >
          {data.contacts.length === 0 ? (
            <Empty title="No contacts" />
          ) : (
            data.contacts.map((c) => (
              <div key={c.id} className="list-item">
                <div className="grow">
                  <div className="small strong">{c.name}</div>
                  <div className="tiny muted">{c.title}</div>
                  <div className="tiny muted">
                    {c.email}
                    {c.phone && ` · ${c.phone}`}
                  </div>
                </div>
                {c.is_decision_maker ? <span className="badge b-opportunity">Decision-maker</span> : null}
                <button className="btn btn-ghost btn-icon" onClick={() => setEditContact(c)} aria-label={`Edit ${c.name}`}>
                  <Icon.Edit />
                </button>
              </div>
            ))
          )}
        </Card>
      </div>

      {modal === "edit" && <AccountForm account={account} onClose={close} onSaved={saved} />}
      {modal === "deal" && <DealForm defaultAccountId={account.id} onClose={close} onSaved={saved} />}
      {modal === "activity" && <ActivityForm accountId={account.id} onClose={close} onSaved={saved} />}
      {(modal === "contact" || editContact) && <ContactForm accountId={account.id} contact={editContact ?? undefined} onClose={close} onSaved={saved} />}
    </>
  );
}

function ContactForm({ accountId, contact, onClose, onSaved }: { accountId: number; contact?: Contact; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: contact?.name ?? "", title: contact?.title ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", is_decision_maker: !!contact?.is_decision_maker });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      if (contact) await api.patch(`/contacts/${contact.id}`, f);
      else await api.post("/contacts", { ...f, account_id: accountId });
      toast(contact ? "Contact updated" : "Contact added");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={contact ? "Edit contact" : "Add contact"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        {error && <div className="error-box full">{error}</div>}
        <Field label="Name">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Title">
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 …" />
        </Field>
        <label className="row full" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={f.is_decision_maker} onChange={(e) => setF({ ...f, is_decision_maker: e.target.checked })} />
          Decision-maker (economic buyer or final approver)
        </label>
      </div>
    </Modal>
  );
}
