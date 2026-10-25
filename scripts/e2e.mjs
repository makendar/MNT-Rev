// Browser walkthrough of the core write workflows. Requires `npm run dev`.
// Creates real records in the local database; run `npm run seed` afterwards for a clean demo.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const BASE = process.env.WEB ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
const step = (s) => console.log("✓", s);

async function signIn(name) {
  await page.goto(BASE);
  await page.click(`.demo-user:has-text("${name}")`);
  await page.waitForSelector(".hero");
}

await signIn("Vikram Mehta");
step("signed in as sales head via demo shortcut");

// Create a deal with a brand-new account from the top bar.
await page.click("button:has-text('New deal')");
await page.fill("input[placeholder^='e.g. Kaveri']", "E2E Test – Data platform");
await page.fill("input[placeholder='Start typing a company name']", "E2E Foods Pvt Ltd");
await page.fill("input[placeholder='2500000']", "3500000");
await page.click("button:has-text('Create deal')");
await page.waitForSelector("h1:has-text('E2E Test')");
const dealUrl = page.url();
step(`created deal → ${dealUrl.replace(BASE, "")}`);

// Advance via the stage stepper.
await page.click(".step:has-text('Discovery')");
await page.waitForSelector(".step.current:has-text('Discovery')");
step("moved stage with the stepper");

// Log an activity with a follow-up.
await page.click("button:has-text('Log activity')");
await page.fill("input[placeholder^='e.g. Pricing']", "Discovery call with CFO");
await page.fill("input[placeholder='e.g. Send revised proposal']", "Send ROI model");
await page.click(".modal-foot button:has-text('Log activity')");
await page.waitForSelector(".tl-item:has-text('Discovery call with CFO')");
await page.waitForSelector(".list-item:has-text('Send ROI model')");
step("logged activity and scheduled follow-up");

// Drag the deal on the board from Discovery to Proposal.
await page.goto(`${BASE}/pipeline?q=E2E`);
const card = page.locator(".deal-card:has-text('E2E Test')");
await card.waitFor();
const proposalCol = page.locator(".col:has(h3:text-is('Proposal'))");
await card.dragTo(proposalCol);
await page.waitForSelector(".col:has(h3:text-is('Proposal')) .deal-card:has-text('E2E Test')");
await page.waitForTimeout(500);
await page.reload();
await page.waitForSelector(".col:has(h3:text-is('Proposal')) .deal-card:has-text('E2E Test')");
step("dragged deal to Proposal on the board (persisted after reload)");

// Drop into Lost requires a reason.
await page.locator(".deal-card:has-text('E2E Test')").dragTo(page.locator(".close-zone.lost"));
await page.waitForSelector(".modal:has-text('Close deal as lost')");
await page.click("label:has-text('Chose competitor')");
await page.click("button:has-text('Mark as lost')");
await page.waitForSelector(".deal-card:has-text('E2E Test')", { state: "detached" });
step("closed as lost with a reason");

// Complete a follow-up from the follow-ups page.
await page.goto(`${BASE}/follow-ups?view=overdue`);
await page.waitForSelector("tbody tr");
const before = await page.locator("tbody tr").count();
await page.locator("tbody tr input[type=checkbox]").first().click();
await page.waitForFunction((n) => document.querySelectorAll("tbody tr").length === n - 1, before);
step("completed an overdue follow-up");

// Import the sample CSV.
await page.goto(`${BASE}/import`);
await page.click("button:has-text('Or try with the sample rows')");
await page.click("button:has-text('Validate')");
await page.waitForSelector("text=Validation result");
await page.click("button:has-text('Import 3 valid rows')");
await page.waitForSelector("text=3 deals created");
step("imported sample CSV (3 rows)");

// Forecast scenario slider changes the projection.
await page.goto(`${BASE}/forecast`);
const projected = page.locator(".kpi:has-text('Projected') .kpi-value");
const p1 = await projected.textContent();
await page.click("button:has-text('Upside case')");
const p2 = await projected.textContent();
assert.notEqual(p1, p2);
step(`forecast scenario: ${p1} → ${p2}`);

// Rep view is scoped.
await page.click("button[title='Sign out']");
await signIn("Arjun Singh");
await page.goto(`${BASE}/pipeline?view=table`);
await page.waitForSelector("tbody tr");
const owners = await page.locator("tbody tr td:nth-child(5)").allTextContents();
assert.ok(owners.length && owners.every((o) => o === "Arjun Singh"), "rep sees only own deals");
assert.equal(await page.locator("select[aria-label='View as']").count(), 0);
step(`rep sees only own deals (${owners.length})`);

await browser.close();
if (errors.length) {
  console.error("Errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("All flows passed");
