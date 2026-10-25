import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { daysBetween } from "../../shared/dates.ts";
import { fmtShortDate } from "../../shared/format.ts";
import { Icon } from "../components/icons";
import { Empty, ErrorState, Field, Loading, Modal, Money, PageHead } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";

interface AccountRow {
  id: number;
  name: string;
  industry: string;
  city: string;
  size: string;
  owner_name: string | null;
  contacts: number;
  open_deals: number;
  open_amount: number;
  won_amount: number;
  last_activity: string | null;
}

export function Accounts() {
  const meta = useMeta();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") ?? "";
  const { data, error, loading, reload } = useApi<AccountRow[]>(`/accounts${qs({ filter })}`);
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState("");
  const [adding, setAdding] = useState(false);

  const industries = useMemo(() => [...new Set((data ?? []).map((a) => a.industry).filter(Boolean))].sort(), [data]);
  const rows = (data ?? []).filter((a) => (!q || `${a.name} ${a.city}`.toLowerCase().includes(q.toLowerCase())) && (!industry || a.industry === industry));

  return (
    <>
      <PageHead title="Accounts" subtitle={filter === "expansion" ? "Customers who have bought before but have no open opportunity" : `${data?.length ?? 0} companies`}>
        <div className="seg">
          <button className={!filter ? "active" : ""} onClick={() => setParams({})}>
            All
          </button>
          <button className={filter === "expansion" ? "active" : ""} onClick={() => setParams({ filter: "expansion" })}>
            Expansion candidates
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon.Plus /> New account
        </button>
      </PageHead>
      <div className="filters">
        <input type="search" placeholder="Search name or city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
        <select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry">
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <div className="card">
          <Empty title="No accounts found" />
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Industry</th>
                <th>Owner</th>
                <th className="r">Open deals</th>
                <th className="r">Open pipeline</th>
                <th className="r">Won to date</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const idle = a.last_activity ? daysBetween(a.last_activity.slice(0, 10), meta.today) : null;
                return (
                  <tr key={a.id} className="clickable" onClick={() => nav(`/accounts/${a.id}`)}>
                    <td>
                      <div className="cell-title">{a.name}</div>
                      <div className="cell-sub">
                        {a.city}
                        {a.size && ` · ${a.size} employees`}
                      </div>
                    </td>
                    <td>{a.industry || "—"}</td>
                    <td>{a.owner_name ?? "—"}</td>
                    <td className="r num">{a.open_deals}</td>
                    <td className="r strong">{a.open_amount ? <Money value={a.open_amount} /> : "—"}</td>
                    <td className="r">{a.won_amount ? <Money value={a.won_amount} /> : "—"}</td>
                    <td className={idle !== null && idle > 30 && a.open_deals ? "warn-text" : "muted"}>{a.last_activity ? `${fmtShortDate(a.last_activity)} (${idle}d)` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <AccountForm
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            nav(`/accounts/${id}`);
          }}
        />
      )}
    </>
  );
}

export function AccountForm({ account, onClose, onSaved }: { account?: any; onClose: () => void; onSaved: (id: number) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: account?.name ?? "", industry: account?.industry ?? "", city: account?.city ?? "", size: account?.size ?? "", website: account?.website ?? "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      if (account) {
        await api.patch(`/accounts/${account.id}`, f);
        toast("Account updated");
        onSaved(account.id);
      } else {
        const r = await api.post<{ id: number }>("/accounts", f);
        toast("Account created");
        onSaved(r.id);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={account ? "Edit account" : "New account"}
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
        <Field label="Company name" full>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Industry">
          <input value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} />
        </Field>
        <Field label="City">
          <input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
        </Field>
        <Field label="Employees">
          <select value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>
            <option value="">—</option>
            <option>1-50</option>
            <option>50-200</option>
            <option>200-500</option>
            <option>500-1000</option>
            <option>1000+</option>
          </select>
        </Field>
        <Field label="Website">
          <input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="example.in" />
        </Field>
      </div>
    </Modal>
  );
}
