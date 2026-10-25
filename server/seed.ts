import { addDays, daysBetween, fiscalQuarter, recentQuarters, shiftQuarter, today } from "../shared/dates.ts";
import { LOST_REASONS } from "../shared/types.ts";
import { hashPassword } from "./auth.ts";
import { all, get, resetDatabase, run, tx } from "./db.ts";

/**
 * Synthetic demonstration data for a fictional Pune-based IT services firm.
 * All companies and people are invented. Dates are generated relative to today
 * so the demo always looks current. Seeded PRNG keeps the data reproducible.
 */

export const DEMO_PASSWORD = "demo1234";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261025;
let rand = mulberry32(SEED);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
const intBetween = (a: number, b: number) => Math.floor(between(a, b + 1));
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [item, w] of items) {
    if ((r -= w) <= 0) return item;
  }
  return items[items.length - 1][0];
}
const timeOfDay = () => `T${String(intBetween(9, 18)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}:00`;

const ACCOUNTS: [string, string, string, string][] = [
  ["Kaveri Logistics Pvt Ltd", "Logistics", "Chennai", "500-1000"],
  ["Indus Finserv Ltd", "Financial services", "Mumbai", "1000+"],
  ["Nilgiri Healthcare Group", "Healthcare", "Coimbatore", "1000+"],
  ["Deccan Auto Components", "Manufacturing", "Pune", "500-1000"],
  ["Sabarmati Textiles Ltd", "Textiles", "Ahmedabad", "200-500"],
  ["Brahmaputra Agro Foods", "FMCG", "Guwahati", "200-500"],
  ["Konkan Ports & Shipping", "Logistics", "Mumbai", "500-1000"],
  ["Vindhya Cement Works", "Manufacturing", "Indore", "1000+"],
  ["Malabar Spice Exports", "Exports", "Kochi", "50-200"],
  ["Aravalli Retail Ventures", "Retail", "Jaipur", "500-1000"],
  ["Godavari Life Sciences", "Pharma", "Hyderabad", "1000+"],
  ["Narmada Power Systems", "Energy", "Vadodara", "200-500"],
  ["Thar Solar Energy", "Energy", "Jodhpur", "50-200"],
  ["Hooghly Engineering Works", "Manufacturing", "Kolkata", "500-1000"],
  ["Sahyadri Cooperative Bank", "Banking", "Pune", "200-500"],
  ["Cauvery EdTech", "Education", "Bengaluru", "50-200"],
  ["Tapti Chemicals Ltd", "Chemicals", "Surat", "200-500"],
  ["Mahanadi Steel Traders", "Distribution", "Bhubaneswar", "50-200"],
  ["Krishna Diagnostics", "Healthcare", "Vijayawada", "200-500"],
  ["Western Ghats Hospitality", "Hospitality", "Goa", "200-500"],
  ["Ganga Insurance Brokers", "Insurance", "Delhi NCR", "50-200"],
  ["Yamuna Realty Developers", "Real estate", "Delhi NCR", "200-500"],
  ["Charminar Fintech Labs", "Fintech", "Hyderabad", "50-200"],
  ["Lakshadweep Marine Foods", "Exports", "Kochi", "50-200"],
  ["Shivalik Pharma Distributors", "Pharma", "Chandigarh", "200-500"],
  ["Coromandel Agritech", "Agriculture", "Chennai", "50-200"],
  ["Mysore Silk Emporium", "Retail", "Mysuru", "50-200"],
  ["Bandra Media Collective", "Media", "Mumbai", "50-200"],
  ["Electronic City Devices", "Electronics", "Bengaluru", "500-1000"],
  ["Kutch Salt & Minerals", "Mining", "Bhuj", "200-500"],
  ["Pench Wildlife Resorts", "Hospitality", "Nagpur", "50-200"],
  ["Hampi Heritage Tours", "Travel", "Bengaluru", "50-200"],
  ["Sunderbans Microfinance", "Financial services", "Kolkata", "200-500"],
  ["Rann Utsav Events", "Events", "Ahmedabad", "50-200"],
  ["Dal Lake Handicrafts", "Exports", "Srinagar", "50-200"],
  ["Palghat Rubber Products", "Manufacturing", "Palakkad", "200-500"],
  ["Nashik Valley Wineries", "FMCG", "Nashik", "50-200"],
  ["Ooty Tea Estates", "FMCG", "Ooty", "200-500"],
  ["Chilika Aqua Farms", "Agriculture", "Bhubaneswar", "50-200"],
  ["Sundaram Motors Dealership", "Automotive", "Chennai", "200-500"],
  ["Ujjain Warehousing Corp", "Logistics", "Ujjain", "200-500"],
  ["Pragati Housing Finance", "Financial services", "Pune", "500-1000"],
  ["Bharat Tiles & Ceramics", "Manufacturing", "Morbi", "200-500"],
  ["Navi Mumbai Data Hub", "IT infrastructure", "Navi Mumbai", "50-200"],
  ["Sangam Hospitals", "Healthcare", "Prayagraj", "500-1000"],
  ["Lotus Learning Academy", "Education", "Lucknow", "50-200"],
];

const FIRST = ["Aditi", "Rahul", "Sneha", "Karthik", "Meera", "Sanjay", "Pooja", "Nikhil", "Divya", "Amit", "Lakshmi", "Faisal", "Neha", "Suresh", "Ritu", "Harish", "Ishita", "Manoj", "Zoya", "Gaurav", "Anjali", "Venkat", "Tanvi", "Deepak", "Farah", "Siddharth"];
const LAST = ["Sharma", "Iyer", "Reddy", "Patel", "Kulkarni", "Banerjee", "Menon", "Gupta", "Khan", "Joshi", "Rao", "Chatterjee", "Pillai", "Verma", "Shah", "Naidu", "Bose", "Kapoor", "Hegde", "Malhotra"];
const TITLES: [string, boolean][] = [
  ["Chief Technology Officer", true],
  ["Chief Financial Officer", true],
  ["Director \u2013 Operations", true],
  ["Managing Director", true],
  ["Head of IT", false],
  ["VP Engineering", true],
  ["Procurement Manager", false],
  ["IT Manager", false],
  ["Digital Transformation Lead", false],
];
const PRODUCTS = ["Cloud migration", "Data & analytics", "Custom software", "Managed services", "Cybersecurity audit", "ERP implementation"];

// Win propensity by source and rep so the analytics tell a real story.
const SOURCE_WEIGHT: [string, number, number][] = [
  // [source, frequency, win multiplier]
  ["Referral", 16, 1.55],
  ["Website", 20, 0.95],
  ["LinkedIn", 16, 0.8],
  ["Partner", 12, 1.25],
  ["Outbound", 18, 0.6],
  ["Event", 8, 0.9],
  ["Existing customer", 10, 1.7],
];

interface SeedUser {
  name: string;
  email: string;
  role: "owner" | "manager" | "rep";
  title: string;
  team: number | null;
  skill: number;
}

const USERS: SeedUser[] = [
  { name: "Ananya Rao", email: "ananya@sahyadritech.in", role: "owner", title: "Founder & CEO", team: null, skill: 1 },
  { name: "Vikram Mehta", email: "vikram@sahyadritech.in", role: "manager", title: "Head of Sales", team: null, skill: 1.1 },
  { name: "Priya Nair", email: "priya@sahyadritech.in", role: "rep", title: "Enterprise Account Executive", team: 0, skill: 1.3 },
  { name: "Arjun Singh", email: "arjun@sahyadritech.in", role: "rep", title: "Enterprise Account Executive", team: 0, skill: 1.0 },
  { name: "Kavya Iyer", email: "kavya@sahyadritech.in", role: "rep", title: "Mid-Market Account Executive", team: 1, skill: 1.1 },
  { name: "Rohan Desai", email: "rohan@sahyadritech.in", role: "rep", title: "Mid-Market Account Executive", team: 1, skill: 0.7 },
];

const STAGES = [
  { name: "Lead", probability: 0.1, expected_days: 10 },
  { name: "Qualified", probability: 0.2, expected_days: 14 },
  { name: "Discovery", probability: 0.35, expected_days: 21 },
  { name: "Proposal", probability: 0.55, expected_days: 21 },
  { name: "Negotiation", probability: 0.75, expected_days: 21 },
];

const ACTIVITY_SUBJECTS: Record<number, string[]> = {
  1: ["Intro call", "Inbound enquiry response", "LinkedIn connect & intro"],
  2: ["Qualification call", "Budget & timeline check", "Shared capability deck"],
  3: ["Discovery workshop", "Requirements walkthrough", "Technical deep dive", "Stakeholder mapping call"],
  4: ["Proposal presentation", "Commercials discussion", "Solution demo", "Proposal follow-up"],
  5: ["Negotiation call", "Legal / MSA review", "Final pricing discussion", "Procurement follow-up"],
};

export function seed() {
  rand = mulberry32(SEED);
  resetDatabase();
  const T = today();
  const pw = hashPassword(DEMO_PASSWORD);

  tx(() => {
    const org = Number(run("INSERT INTO organizations (name, currency, fy_start_month) VALUES (?, 'INR', 4)", "Sahyadri Tech Solutions Pvt Ltd").lastInsertRowid);
    const teams = ["Enterprise", "Mid-Market"].map((n) => Number(run("INSERT INTO teams (org_id, name) VALUES (?,?)", org, n).lastInsertRowid));
    const userIds = USERS.map((u) =>
      Number(
        run(
          "INSERT INTO users (org_id, team_id, name, email, password_hash, role, title) VALUES (?,?,?,?,?,?,?)",
          org,
          u.team === null ? null : teams[u.team],
          u.name,
          u.email,
          pw,
          u.role,
          u.title,
        ).lastInsertRowid,
      ),
    );
    const sellers = USERS.map((u, i) => ({ ...u, id: userIds[i] })).filter((u) => u.role !== "owner");

    const stageIds = STAGES.map((s, i) =>
      Number(
        run("INSERT INTO stages (org_id, name, position, probability, expected_days) VALUES (?,?,?,?,?)", org, s.name, i + 1, s.probability, s.expected_days).lastInsertRowid,
      ),
    );
    const wonId = Number(run("INSERT INTO stages (org_id, name, position, probability, is_won, expected_days) VALUES (?, 'Closed Won', 6, 1, 1, 0)", org).lastInsertRowid);
    const lostId = Number(run("INSERT INTO stages (org_id, name, position, probability, is_lost, expected_days) VALUES (?, 'Closed Lost', 7, 0, 1, 0)", org).lastInsertRowid);

    const accounts = ACCOUNTS.map(([name, industry, city, size]) => {
      const owner = pick(sellers.filter((s) => s.role === "rep"));
      const created = addDays(T, -intBetween(200, 520));
      const domain = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z]+/g, "").slice(0, 18);
      const id = Number(
        run("INSERT INTO accounts (org_id, name, industry, city, size, website, owner_id, created_at) VALUES (?,?,?,?,?,?,?,?)", org, name, industry, city, size, `${domain}.in`, owner.id, created).lastInsertRowid,
      );
      const contacts: { id: number; dm: boolean }[] = [];
      const n = intBetween(1, 3);
      for (let i = 0; i < n; i++) {
        const first = pick(FIRST);
        const last = pick(LAST);
        const [title, dm] = pick(TITLES);
        const cid = Number(
          run(
            "INSERT INTO contacts (org_id, account_id, name, title, email, phone, is_decision_maker) VALUES (?,?,?,?,?,?,?)",
            org,
            id,
            `${first} ${last}`,
            title,
            `${first.toLowerCase()}.${last.toLowerCase()}@${domain}.in`,
            `+91 9${intBetween(100000000, 999999999)}`,
            dm ? 1 : 0,
          ).lastInsertRowid,
        );
        contacts.push({ id: cid, dm });
      }
      return { id, name, owner, contacts };
    });

    const DEALS = 380;
    for (let i = 0; i < DEALS; i++) {
      // Bias creation dates towards the recent past so there is a healthy open pipeline.
      const ageDays = Math.floor(Math.pow(rand(), 1.15) * 560) + 1;
      const created = addDays(T, -ageDays);
      const account = pick(accounts);
      const owner = rand() < 0.75 ? account.owner : weighted(sellers.map((s) => [s, s.role === "manager" ? 1 : 3] as [typeof s, number]));
      const [source, , srcMult] = weighted(SOURCE_WEIGHT.map((s) => [s, s[1]] as [typeof s, number]));
      const product = pick(PRODUCTS);
      const amount = Math.round(Math.exp(between(Math.log(2.5e5), Math.log(1.2e7))) / 50_000) * 50_000;
      const contact = rand() < 0.85 ? pick(account.contacts) : null;

      const winP = Math.min(0.8, 0.33 * srcMult * owner.skill * (contact?.dm ? 1.2 : 0.85) * (amount > 6e6 ? 0.8 : 1));
      const won = rand() < winP;
      const lostAt = won ? 5 : weighted([[1, 2], [2, 3], [3, 4], [4, 4], [5, 2]] as [number, number][]);
      const lastStage = won ? 5 : lostAt;

      // Some deals go quiet: no stage movement or activity after the stall point.
      const stalled = ageDays > 25 && rand() < 0.3;
      const limit = stalled ? addDays(T, -intBetween(16, Math.min(60, ageDays - 5))) : T;

      // Walk stages forward from creation; stop at the limit if the deal hasn't finished.
      const history: { stage: number; at: string }[] = [{ stage: stageIds[0], at: created }];
      let cursor = created;
      let closedAt: string | null = null;
      let currentStageIdx = 0;
      let finished = false;
      for (let s = 0; s < lastStage; s++) {
        // Procurement and legal make negotiation the slowest real-world stage.
        const spread = s === 4 ? between(1.2, 3) : between(0.5, 1.7);
        const dur = Math.max(2, Math.round(STAGES[s].expected_days * spread * (owner.skill < 0.9 ? 1.3 : 1)));
        const next = addDays(cursor, dur);
        if (next > limit) break;
        cursor = next;
        if (s === lastStage - 1) {
          closedAt = cursor;
          history.push({ stage: won ? wonId : lostId, at: cursor });
          finished = true;
        } else {
          currentStageIdx = s + 1;
          history.push({ stage: stageIds[s + 1], at: cursor });
        }
      }
      // Very old deals that somehow didn't finish are closed as lost (no decision).
      let forcedLost = false;
      if (!finished && ageDays > 260) {
        closedAt = addDays(cursor, intBetween(10, 40));
        if (closedAt > T) closedAt = T;
        history.push({ stage: lostId, at: closedAt });
        finished = true;
        forcedLost = true;
      }

      const isWon = finished && history[history.length - 1].stage === wonId;
      const stageId = finished ? (isWon ? wonId : lostId) : stageIds[currentStageIdx];
      const stageEntered = history[history.length - 1].at;

      // Planned close date: created + typical remaining cycle with optimism bias.
      const plannedCycle = intBetween(70, 160);
      let expectedClose = addDays(created, plannedCycle);
      let pushes = 0;
      if (!finished) {
        // Active deals get their close date pushed out; stalled ones are often left stale.
        while (expectedClose < T && rand() < (stalled ? 0.35 : 0.85)) {
          expectedClose = addDays(expectedClose, intBetween(25, 90));
          pushes++;
        }
      } else {
        expectedClose = closedAt!;
      }

      const forecast = finished
        ? isWon
          ? "commit"
          : "omitted"
        : currentStageIdx === 4
          ? rand() < 0.7 ? "commit" : "best_case"
          : currentStageIdx === 3
            ? rand() < 0.55 ? "best_case" : "pipeline"
            : "pipeline";

      // Activities through the deal's life. Stalled deals go quiet for a while.
      const endOfLife = closedAt ?? limit;
      const acts: { at: string; type: string; subject: string; stage: number }[] = [];
      let a = addDays(created, intBetween(0, 2));
      while (a <= endOfLife) {
        const stageAt = history.filter((h) => h.at <= a).length;
        const stagePos = Math.min(5, Math.max(1, stageAt));
        const type = weighted([["call", 4], ["email", 5], ["meeting", 2], ["demo", stagePos >= 3 ? 1.5 : 0.2], ["note", 1]] as [string, number][]);
        acts.push({ at: a, type, subject: pick(ACTIVITY_SUBJECTS[stagePos]), stage: stagePos });
        a = addDays(a, intBetween(3, 11));
      }
      const lastActivity = acts.length ? acts[acts.length - 1].at + timeOfDay() : null;

      const nextStep = finished
        ? ""
        : stalled && rand() < 0.5
          ? ""
          : pick(["Send revised proposal", "Schedule technical demo", "Confirm budget with CFO", "Share case study", "Book discovery workshop", "Get MSA redlines back", "Follow up on PO"]);
      const nextStepDate = nextStep ? addDays(T, stalled ? -intBetween(3, 20) : intBetween(-2, 12)) : null;

      const lostReason = finished && !isWon ? (forcedLost ? "No decision / stalled" : pick(LOST_REASONS)) : null;
      const dealName = `${account.name.split(" ").slice(0, 2).join(" ")} \u2013 ${product}`;

      const dealId = Number(
        run(
          `INSERT INTO deals (org_id, account_id, contact_id, name, amount, stage_id, owner_id, source, product_line,
             expected_close_date, created_at, stage_entered_at, last_activity_at, next_step, next_step_date,
             forecast_category, close_date_pushes, lost_reason, closed_at, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          org, account.id, contact?.id ?? null, dealName, amount, stageId, owner.id, source, product,
          expectedClose, created, stageEntered, lastActivity, nextStep, nextStepDate,
          forecast, pushes, lostReason, closedAt, "",
        ).lastInsertRowid,
      );

      let prev: number | null = null;
      for (const h of history) {
        run("INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_at, changed_by) VALUES (?,?,?,?,?)", dealId, prev, h.stage, h.at + timeOfDay(), owner.id);
        prev = h.stage;
      }
      for (const act of acts) {
        run(
          "INSERT INTO activities (org_id, deal_id, account_id, user_id, type, subject, notes, outcome, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
          org, dealId, account.id, owner.id, act.type, act.subject, "",
          pick(["Positive", "Neutral", "Needs follow-up", "Positive", ""]),
          act.at + timeOfDay(),
        );
      }

      if (!finished) {
        const openTasks = intBetween(0, 2) + (stalled ? 1 : 0);
        for (let k = 0; k < openTasks; k++) {
          const due = stalled ? addDays(T, -intBetween(1, 14)) : addDays(T, intBetween(-4, 14));
          run(
            "INSERT INTO tasks (org_id, deal_id, assigned_to, created_by, title, type, due_date, priority, status) VALUES (?,?,?,?,?,?,?,?, 'open')",
            org, dealId, owner.id, owner.id,
            pick(["Follow up on proposal", "Call to confirm decision timeline", "Send pricing options", "Share reference customer", "Check in with champion", "Chase PO status", "Schedule demo for IT team"]),
            pick(["call", "email", "follow_up", "meeting"]),
            due,
            weighted([["high", 2], ["medium", 3], ["low", 1]] as [string, number][]),
          );
        }
      }
      const doneTasks = intBetween(0, 3);
      for (let k = 0; k < doneTasks && acts.length; k++) {
        const act = pick(acts);
        run(
          "INSERT INTO tasks (org_id, deal_id, assigned_to, created_by, title, type, due_date, priority, status, completed_at) VALUES (?,?,?,?,?,?,?,?, 'done', ?)",
          org, dealId, owner.id, owner.id, `Follow up: ${act.subject}`, "follow_up", act.at, "medium", act.at,
        );
      }
    }

    // A few general to-dos not tied to a deal.
    for (const s of sellers) {
      run(
        "INSERT INTO tasks (org_id, deal_id, assigned_to, created_by, title, type, due_date, priority, status) VALUES (?, NULL, ?, ?, ?, 'admin', ?, 'low', 'open')",
        org, s.id, s.id, "Update pipeline before Monday review", addDays(T, intBetween(0, 5)),
      );
    }

    // Targets: grounded in each seller's historical wins so attainment is realistic.
    const quarters = [...recentQuarters(T, 6), shiftQuarter(fiscalQuarter(T), 1)];
    const past = quarters.slice(0, 5);
    let companyBase = 0;
    for (const s of sellers) {
      const wonTotal = get<{ v: number }>(
        "SELECT COALESCE(SUM(amount),0) v FROM deals WHERE owner_id = ? AND stage_id = ? AND closed_at BETWEEN ? AND ?",
        s.id, wonId, past[0].start, past[past.length - 1].end,
      )!.v;
      const base = Math.max(2.5e6, wonTotal / past.length);
      companyBase += base;
      quarters.forEach((q, i) => {
        // This year's plan carries a growth stretch over last year's run-rate.
        const growth = i >= past.length ? 1.35 : 1.1;
        run("INSERT INTO targets (org_id, user_id, period_key, amount) VALUES (?,?,?,?)", org, s.id, q.key, Math.round((base * growth) / 5e5) * 5e5);
      });
    }
    quarters.forEach((q, i) => {
      const growth = i >= past.length ? 1.35 : 1.1;
      run("INSERT INTO targets (org_id, user_id, period_key, amount) VALUES (?, NULL, ?, ?)", org, q.key, Math.round((companyBase * growth) / 5e5) * 5e5);
    });
  });

  const counts = get("SELECT (SELECT COUNT(*) FROM deals) deals, (SELECT COUNT(*) FROM activities) activities, (SELECT COUNT(*) FROM tasks) tasks")!;
  const open = all("SELECT s.name, COUNT(*) n FROM deals d JOIN stages s ON s.id = d.stage_id GROUP BY s.name ORDER BY s.position");
  return { counts, byStage: open, daysSpan: daysBetween(addDays(T, -470), T) };
}

if (process.argv.includes("--reset")) {
  const result = seed();
  console.log("Seeded MNT Revenue demo data:", result.counts);
  console.table(result.byStage);
}
