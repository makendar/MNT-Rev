// Visual smoke test: signs in, visits every page, saves screenshots and reports console errors.
// Usage: node scripts/screens.mjs [email]   (requires `npm run dev` to be running)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.WEB ?? "http://localhost:5173";
const email = process.argv[2] ?? "vikram@sahyadritech.in";
const out = "screens";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(BASE);
await page.waitForSelector(".demo-user", { timeout: 10000 });
await page.screenshot({ path: `${out}/00-login.png` });
await page.fill("#email", email);
await page.fill("#pw", "demo1234");
await page.click("button:has-text('Sign in')");
await page.waitForSelector(".hero, .kpi", { timeout: 15000 });

const pages = [
  ["01-dashboard", "/"],
  ["02-insights", "/insights"],
  ["03-pipeline", "/pipeline"],
  ["04-pipeline-table", "/pipeline?view=table&risk=high"],
  ["05-followups", "/follow-ups"],
  ["06-accounts", "/accounts"],
  ["07-forecast", "/forecast"],
  ["08-analytics", "/analytics"],
  ["09-import", "/import"],
  ["10-settings", "/settings"],
];
for (const [name, path] of pages) {
  await page.goto(BASE + path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}

// Deal detail: open the first at-risk deal from the dashboard.
await page.goto(BASE + "/pipeline?view=table&risk=high");
await page.waitForSelector("tbody tr");
await page.click("tbody tr >> nth=0");
await page.waitForSelector(".stepper");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/11-deal.png`, fullPage: true });

await page.goto(BASE + "/accounts");
await page.waitForSelector("tbody tr");
await page.click("tbody tr >> nth=0");
await page.waitForSelector(".kpi");
await page.screenshot({ path: `${out}/12-account.png`, fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + "/");
await page.waitForSelector(".hero");
await page.screenshot({ path: `${out}/13-mobile.png`, fullPage: false });

await browser.close();
console.log(errors.length ? errors.join("\n") : "No console errors");
