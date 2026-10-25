import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Period } from "../shared/dates.ts";
import type { Stage, User } from "../shared/types.ts";
import { api, setUnauthorizedHandler } from "./lib/api";

export interface Meta {
  org: { id: number; name: string; currency: string; fy_start_month: number };
  today: string;
  currentPeriod: Period;
  stages: Stage[];
  users: (User & { email: string })[];
  teams: { id: number; name: string }[];
  sources: string[];
  lostReasons: string[];
  productLines: string[];
  ai: { engine: string; model: string | null; label: string };
}

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
}

interface AppState {
  user: User | null;
  meta: Meta | null;
  ready: boolean;
  isManager: boolean;
  /** Manager "view as" filter: a rep's id, or null for the whole team. */
  viewAs: number | null;
  setViewAs: (id: number | null) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  toast: (text: string, kind?: "ok" | "error") => void;
  toasts: Toast[];
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ready, setReady] = useState(false);
  const [viewAs, setViewAsState] = useState<number | null>(() => {
    const v = sessionStorage.getItem("mnt_view_as");
    return v ? Number(v) : null;
  });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 3000);
  }, []);

  const refreshMeta = useCallback(async () => setMeta(await api.get<Meta>("/meta")), []);

  const bootstrap = useCallback(async () => {
    try {
      const me = await api.get<User>("/auth/me");
      setUser(me);
      await refreshMeta();
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, [refreshMeta]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setMeta(null);
    });
    bootstrap();
  }, [bootstrap]);

  const setViewAs = (id: number | null) => {
    setViewAsState(id);
    if (id) sessionStorage.setItem("mnt_view_as", String(id));
    else sessionStorage.removeItem("mnt_view_as");
  };

  const value = useMemo<AppState>(
    () => ({
      user,
      meta,
      ready,
      isManager: user?.role === "owner" || user?.role === "manager",
      viewAs: user?.role === "rep" ? null : viewAs,
      setViewAs,
      signIn: async (email, password) => {
        await api.post("/auth/login", { email, password });
        setViewAs(null);
        await bootstrap();
      },
      signOut: async () => {
        await api.post("/auth/logout").catch(() => {});
        setUser(null);
        setMeta(null);
      },
      refreshMeta,
      toast,
      toasts,
    }),
    [user, meta, ready, viewAs, bootstrap, refreshMeta, toast, toasts],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

/** Convenience: meta is guaranteed inside authenticated routes. */
export function useMeta(): Meta {
  const { meta } = useApp();
  if (!meta) throw new Error("Meta not loaded");
  return meta;
}
