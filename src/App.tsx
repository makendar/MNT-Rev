import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { AccountDetail } from "./pages/AccountDetail";
import { Accounts } from "./pages/Accounts";
import { Analytics } from "./pages/Analytics";
import { Dashboard } from "./pages/Dashboard";
import { DealDetail } from "./pages/DealDetail";
import { FollowUps } from "./pages/FollowUps";
import { Forecast } from "./pages/Forecast";
import { ImportData } from "./pages/ImportData";
import { Insights } from "./pages/Insights";
import { Login } from "./pages/Login";
import { Pipeline } from "./pages/Pipeline";
import { Settings } from "./pages/Settings";
import { useApp } from "./state";

export function App() {
  const { ready, user, meta, toasts } = useApp();

  return (
    <>
      {!ready ? (
        <Loading />
      ) : !user || !meta ? (
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      ) : (
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="insights" element={<Insights />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="deals/:id" element={<DealDetail />} />
            <Route path="follow-ups" element={<FollowUps />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="accounts/:id" element={<AccountDetail />} />
            <Route path="forecast" element={<Forecast />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="import" element={<ImportData />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
