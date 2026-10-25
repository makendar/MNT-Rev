// Prints the headline story the demo data tells. Requires the API to be running.
const B = process.env.API ?? "http://localhost:4000/api";

const login = await fetch(`${B}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "vikram@sahyadritech.in", password: "demo1234" }),
});
const h = { cookie: login.headers.get("set-cookie").split(";")[0] };
const get = async (p) => (await fetch(B + p, { headers: h })).json();

const d = await get("/dashboard");
const k = d.kpis;
console.log({ won: k.wonAmount, target: k.target, attainment: k.attainment.toFixed(2), open: k.openAmount, closingThisQ: k.openInPeriodAmount, coverage: k.coverage?.toFixed(1), commit: k.commitAmount, winRate: k.winRate.toFixed(2), overdueTasks: k.overdueTasks });
console.table(d.riskSummary);
const i = await get("/insights");
for (const x of i.insights) console.log(x.severity.padEnd(12), x.title);
const a = await get("/analytics");
console.table(a.bySource.map((s) => ({ source: s.name, won: s.won, lost: s.lost, winRate: s.winRate.toFixed(2) })));
console.table(a.quarters.map((q) => ({ quarter: q.quarter, won: q.won, target: q.target })));
