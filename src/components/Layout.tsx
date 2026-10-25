import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { inrCompact } from "../../shared/format.ts";
import type { DealRow } from "../../shared/types.ts";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useApp, useMeta } from "../state";
import { DealForm } from "./DealForm";
import { Icon } from "./icons";
import { Avatar } from "./ui";

const NAV = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Command centre", icon: Icon.Home, end: true },
      { to: "/insights", label: "Insights", icon: Icon.Spark },
    ],
  },
  {
    label: "Execute",
    items: [
      { to: "/pipeline", label: "Pipeline", icon: Icon.Board },
      { to: "/follow-ups", label: "Follow-ups", icon: Icon.CheckSquare, badge: true },
      { to: "/accounts", label: "Accounts", icon: Icon.Building },
    ],
  },
  {
    label: "Analyse",
    items: [
      { to: "/forecast", label: "Forecast", icon: Icon.Target },
      { to: "/analytics", label: "Analytics", icon: Icon.Chart },
    ],
  },
  {
    label: "Data",
    items: [
      { to: "/import", label: "Import & export", icon: Icon.Upload },
      { to: "/settings", label: "Settings", icon: Icon.Settings },
    ],
  },
];

export function Layout() {
  const { user, isManager, viewAs, setViewAs, signOut } = useApp();
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [newDeal, setNewDeal] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const overdue = useApi<{ counts: { overdue: number } }>(`/tasks?view=overdue${viewAs ? `&assignee=${viewAs}` : ""}`);

  useEffect(() => {
    setOpen(false);
    overdue.reload();
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const reps = meta.users.filter((u) => u.role !== "owner" && u.active);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Icon.Logo />
          </div>
          <div>
            <div className="brand-name">MNT Revenue</div>
            <div className="brand-sub">Measure · Navigate · Transform</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={(i as any).end}>
                  <i.icon />
                  {i.label}
                  {(i as any).badge && overdue.data?.counts.overdue ? <span className="nav-count">{overdue.data.counts.overdue}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <strong>{meta.org.name}</strong>
          <div>
            {meta.currentPeriod.label} · FY starts {new Date(2000, meta.org.fy_start_month - 1, 1).toLocaleDateString("en-IN", { month: "long" })}
          </div>
          <div style={{ marginTop: 6 }}>An MNT Analytics product</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setOpen(!open)} aria-label="Menu">
            <Icon.Menu />
          </button>
          <GlobalSearch />
          <div className="topbar-right">
            {isManager && (
              <select
                className="hide-sm"
                value={viewAs ?? ""}
                onChange={(e) => setViewAs(e.target.value ? Number(e.target.value) : null)}
                aria-label="View as"
                title="Scope dashboards, insights and forecasts to one salesperson"
              >
                <option value="">Whole team</option>
                {reps.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-primary" onClick={() => setNewDeal(true)}>
              <Icon.Plus /> <span className="hide-sm">New deal</span>
            </button>
            <div className="row" style={{ gap: 8 }}>
              <Avatar name={user!.name} />
              <div className="hide-sm" style={{ lineHeight: 1.2 }}>
                <div className="strong small">{user!.name}</div>
                <div className="tiny muted">{user!.title}</div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={signOut} title="Sign out" aria-label="Sign out">
                <Icon.Logout />
              </button>
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {newDeal && (
        <DealForm
          onClose={() => setNewDeal(false)}
          onSaved={(id) => {
            setNewDeal(false);
            nav(`/deals/${id}`);
          }}
        />
      )}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DealRow[]>([]);
  const [accounts, setAccounts] = useState<{ id: number; name: string; city: string }[]>([]);
  const [show, setShow] = useState(false);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setAccounts([]);
      return;
    }
    const t = setTimeout(async () => {
      const [d, a] = await Promise.all([
        api.get<DealRow[]>(`/deals?q=${encodeURIComponent(q.trim())}`),
        api.get<{ id: number; name: string; city: string }[]>("/accounts"),
      ]);
      setResults(d.slice(0, 6));
      setAccounts(a.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 4));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setShow(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const go = (path: string) => {
    setShow(false);
    setQ("");
    nav(path);
  };

  return (
    <div className="search" ref={box}>
      <Icon.Search />
      <input
        type="search"
        placeholder="Search deals and accounts…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setShow(true);
        }}
        onFocus={() => setShow(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) go(`/deals/${results[0].id}`);
          if (e.key === "Escape") setShow(false);
        }}
        aria-label="Search"
      />
      {show && (results.length > 0 || accounts.length > 0) && (
        <div className="search-results">
          {accounts.map((a) => (
            <a key={`a${a.id}`} href={`/accounts/${a.id}`} onClick={(e) => (e.preventDefault(), go(`/accounts/${a.id}`))}>
              <span className="ellipsis">
                <Icon.Building size={13} /> {a.name}
              </span>
              <span className="muted small">{a.city}</span>
            </a>
          ))}
          {results.map((d) => (
            <a key={d.id} href={`/deals/${d.id}`} onClick={(e) => (e.preventDefault(), go(`/deals/${d.id}`))}>
              <span className="ellipsis">{d.name}</span>
              <span className="muted small num">
                {d.stage_name} · {inrCompact(d.amount)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
