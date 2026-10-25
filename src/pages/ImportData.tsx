import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/icons";
import { Card, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { autoMap, IMPORT_FIELDS, parseCSV, TEMPLATE_CSV } from "../lib/csv";
import { useApp } from "../state";

interface ImportResult {
  dryRun: boolean;
  total: number;
  valid: number;
  created: number;
  results: { row: number; errors: string[]; warnings: string[] }[];
}

export function ImportData() {
  const { toast, refreshMeta } = useApp();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const headers = rows[0] ?? [];
  const body = rows.slice(1);

  function load(text: string, name: string) {
    setResult(null);
    setParseError(null);
    const parsed = parseCSV(text);
    if (parsed.length < 2) {
      setParseError("The file needs a header row and at least one data row.");
      setRows([]);
      return;
    }
    setRows(parsed);
    setMap(autoMap(parsed[0]));
    setFileName(name);
  }

  function readFile(f: File) {
    if (!/\.csv$/i.test(f.name)) {
      setParseError("Please choose a .csv file. In Excel use File → Save As → CSV UTF-8.");
      return;
    }
    if (f.size > 5_000_000) {
      setParseError("File is larger than 5 MB. Split it into smaller files.");
      return;
    }
    f.text().then((t) => load(t, f.name));
  }

  const mapped = () =>
    body.map((r) => {
      const o: Record<string, string> = {};
      for (const [k, i] of Object.entries(map)) if (i >= 0) o[k] = r[i]?.trim() ?? "";
      return o;
    });

  const missingRequired = IMPORT_FIELDS.filter((f) => "required" in f && f.required && !(map[f.key] >= 0));

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api.post<ImportResult>("/import/deals", { rows: mapped(), dryRun });
      setResult(r);
      if (!dryRun) {
        toast(`Imported ${r.created} deals`);
        refreshMeta();
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob(["\uFEFF" + TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mnt-revenue-import-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <PageHead title="Import & export" subtitle="Move from spreadsheets to a structured pipeline. Validate before anything is written.">
        <button className="btn" onClick={downloadTemplate}>
          <Icon.Download /> Download template
        </button>
        <a className="btn" href="/api/export/deals.csv">
          <Icon.Download /> Export all deals (CSV)
        </a>
      </PageHead>

      <div className="grid g-main-side">
        <div className="stack" style={{ gap: 16 }}>
          <Card title="1. Choose a CSV file" subtitle="Export from Excel, Google Sheets or your CRM as CSV">
            <div className="card-body">
              <label
                className={`dropzone ${drag ? "active" : ""}`}
                style={{ display: "block", cursor: "pointer" }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  const f = e.dataTransfer.files[0];
                  if (f) readFile(f);
                }}
              >
                <Icon.Upload size={22} className="muted" />
                <div className="strong mt-sm">{fileName ? fileName : "Drop a CSV here or click to browse"}</div>
                <div className="small muted">{fileName ? `${body.length} data rows · ${headers.length} columns` : "Up to 5,000 rows · UTF-8"}</div>
                <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              </label>
              <div className="row mt-sm">
                <button className="btn btn-sm btn-ghost" onClick={() => load(TEMPLATE_CSV, "sample-template.csv")}>
                  Or try with the sample rows
                </button>
              </div>
              {parseError && <div className="error-box mt-sm">{parseError}</div>}
            </div>
          </Card>

          {rows.length > 0 && (
            <Card title="2. Map your columns" subtitle="We matched what we could. Adjust anything that looks wrong.">
              <div className="card-body">
                <div className="form-grid">
                  {IMPORT_FIELDS.map((f) => (
                    <div className="field" key={f.key}>
                      <label>
                        {f.label} {"required" in f && f.required && <span className="danger-text">*</span>}
                      </label>
                      <select value={map[f.key] ?? -1} onChange={(e) => {
                          setMap({ ...map, [f.key]: Number(e.target.value) });
                          setResult(null);
                        }}>
                        <option value={-1}>— Not in file —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {missingRequired.length > 0 && <div className="notice warn mt">Map the required fields: {missingRequired.map((f) => f.label).join(", ")}.</div>}
              </div>
            </Card>
          )}

          {rows.length > 0 && (
            <Card title="3. Preview" subtitle={`First ${Math.min(8, body.length)} of ${body.length} rows, as they will be read`}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {IMPORT_FIELDS.filter((f) => map[f.key] >= 0).map((f) => (
                        <th key={f.key}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mapped()
                      .slice(0, 8)
                      .map((r, i) => {
                        const issue = result?.results.find((x) => x.row === i + 1);
                        return (
                          <tr key={i} style={issue?.errors.length ? { background: "var(--danger-soft)" } : undefined}>
                            <td className="muted">{i + 1}</td>
                            {IMPORT_FIELDS.filter((f) => map[f.key] >= 0).map((f) => (
                              <td key={f.key} className="small">
                                {r[f.key] || <span className="faint">—</span>}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <div className="card-body row">
                <button className="btn" onClick={() => run(true)} disabled={busy || missingRequired.length > 0}>
                  Validate
                </button>
                <button className="btn btn-primary" onClick={() => run(false)} disabled={busy || missingRequired.length > 0 || !result?.dryRun || result.valid === 0}>
                  Import {result?.dryRun ? `${result.valid} valid rows` : ""}
                </button>
                {!result && <span className="small muted">Validate first — nothing is saved until you import.</span>}
              </div>
            </Card>
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {result && (
            <Card title={result.dryRun ? "Validation result" : "Import complete"}>
              <div className="card-body stack-sm">
                <div className="row-between">
                  <span>Rows read</span>
                  <b className="num">{result.total}</b>
                </div>
                <div className="row-between">
                  <span>Valid</span>
                  <b className="num ok-text">{result.valid}</b>
                </div>
                <div className="row-between">
                  <span>Will be skipped</span>
                  <b className="num danger-text">{result.total - result.valid}</b>
                </div>
                {!result.dryRun && (
                  <div className="notice mt-sm">
                    {result.created} deals created. <Link to="/pipeline?view=table">View pipeline</Link>
                  </div>
                )}
                {result.results.length > 0 && (
                  <div className="mt-sm stack-sm" style={{ maxHeight: 360, overflow: "auto" }}>
                    {result.results.map((r) => (
                      <div key={r.row} className="small">
                        <b>Row {r.row}</b>
                        {r.errors.map((e, i) => (
                          <div key={`e${i}`} className="danger-text">
                            ✕ {e}
                          </div>
                        ))}
                        {r.warnings.map((w, i) => (
                          <div key={`w${i}`} className="warn-text">
                            ! {w}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}
          <Card title="What the importer understands" pad>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                Amounts like <code>12,50,000</code>, <code>12.5 L</code>, <code>1.2 Cr</code>, <code>₹4,00,000</code>
              </li>
              <li>
                Dates as <code>DD/MM/YYYY</code>, <code>DD-MM-YYYY</code> or <code>YYYY-MM-DD</code>
              </li>
              <li>Accounts and contacts are matched by name, or created if new</li>
              <li>Owners are matched by email; unknown owners are assigned to you</li>
              <li>Unrecognised stages default to the first stage, with a warning</li>
            </ul>
          </Card>
          <Card title="Connectors" subtitle="Status of external integrations in this build" pad>
            <div className="stack-sm small">
              {["CSV / Excel import", "CSV export"].map((c) => (
                <div key={c} className="row-between">
                  <span>{c}</span>
                  <span className="badge b-ok">Working</span>
                </div>
              ))}
              {["Zoho CRM", "HubSpot", "Salesforce", "Gmail / Outlook", "Google / Outlook Calendar", "Website lead forms", "Power BI"].map((c) => (
                <div key={c} className="row-between">
                  <span>{c}</span>
                  <span className="badge">Not connected</span>
                </div>
              ))}
              <p className="tiny muted mt-sm">Live connectors need OAuth credentials and are not implemented in this localhost build. CSV is the supported path today.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
