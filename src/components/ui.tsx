import { useEffect, type ReactNode } from "react";
import { inr, inrCompact } from "../../shared/format.ts";
import type { RiskResult } from "../../shared/types.ts";
import { Icon } from "./icons";

export function Money({ value, full }: { value: number; full?: boolean }) {
  return (
    <span className="num" title={inr(value)}>
      {full ? inr(value) : inrCompact(value)}
    </span>
  );
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, pad, className = "" }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function Kpi({ label, value, sub, progress, pace, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; progress?: number; pace?: number; tone?: "danger" | "ok" | "warn" }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone ? `${tone}-text` : ""}`}>{value}</div>
      {progress !== undefined && (
        <div className="progress" title={pace !== undefined ? "Marker shows where you should be at this point in the period" : undefined}>
          <span style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
          {pace !== undefined && <i className="pace" style={{ left: `${Math.min(100, pace * 100)}%` }} />}
        </div>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function RiskBadge({ risk }: { risk: RiskResult }) {
  return (
    <span className={`badge b-${risk.level}`} title={risk.factors.map((f) => `${f.label} (+${f.points})`).join("\n") || "No risk factors"}>
      <span className="dot" />
      {risk.level === "high" ? "High risk" : risk.level === "medium" ? "Medium risk" : "On track"}
    </span>
  );
}

export function ScoreRing({ score, kind }: { score: number; kind: "risk" | "priority" }) {
  const color = kind === "risk" ? (score >= 60 ? "var(--danger)" : score >= 30 ? "var(--warn)" : "var(--ok)") : "var(--brand)";
  const bg = kind === "risk" ? (score >= 60 ? "var(--danger-soft)" : score >= 30 ? "var(--warn-soft)" : "var(--ok-soft)") : "var(--brand-soft)";
  return (
    <div className="score-ring" style={{ background: `conic-gradient(${color} ${score * 3.6}deg, ${bg} 0)` }} title={`${kind === "risk" ? "Risk" : "Priority"} score ${score}/100`}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", color }}>{score}</div>
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return <span className="avatar">{initials}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading-block" role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card card-pad">
      <div className="row">
        <Icon.Alert className="danger-text" />
        <span>{message}</span>
        {onRetry && (
          <button className="btn btn-sm" onClick={onRetry} style={{ marginLeft: "auto" }}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 760 } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <Icon.X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, full }: { label: string; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function ChartTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="t">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="row" style={{ gap: 6 }}>
          <i style={{ width: 8, height: 8, background: p.color, borderRadius: 2, display: "inline-block" }} />
          <span>{p.name}:</span>
          <b className="num">{format ? format(p.value, p.dataKey) : p.value}</b>
        </div>
      ))}
    </div>
  );
}

export const ACTIVITY_ICON: Record<string, (p: any) => ReactNode> = {
  call: Icon.Phone,
  email: Icon.Mail,
  meeting: Icon.Users,
  demo: Icon.Monitor,
  note: Icon.Note,
};

export const CATEGORY_LABEL: Record<string, string> = {
  pipeline: "Pipeline",
  best_case: "Best case",
  commit: "Commit",
  omitted: "Omitted",
};
