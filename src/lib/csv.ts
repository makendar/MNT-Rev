/** RFC 4180-style CSV parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCSV(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export const IMPORT_FIELDS = [
  { key: "account_name", label: "Account / company", required: true, synonyms: ["account", "company", "client", "customer", "organisation", "organization", "account name", "company name"] },
  { key: "deal_name", label: "Deal name", synonyms: ["deal", "opportunity", "opportunity name", "deal name", "title"] },
  { key: "amount", label: "Amount (₹)", required: true, synonyms: ["amount", "value", "deal value", "deal size", "revenue", "inr", "amount (inr)", "amount inr"] },
  { key: "stage", label: "Stage", synonyms: ["stage", "status", "deal stage", "pipeline stage"] },
  { key: "expected_close_date", label: "Expected close date", required: true, synonyms: ["close date", "expected close", "closing date", "expected close date", "close"] },
  { key: "owner_email", label: "Owner email", synonyms: ["owner", "owner email", "salesperson", "rep", "assigned to", "sales rep email"] },
  { key: "source", label: "Lead source", synonyms: ["source", "lead source", "channel"] },
  { key: "product_line", label: "Product / service", synonyms: ["product", "service", "product line", "offering"] },
  { key: "contact_name", label: "Contact name", synonyms: ["contact", "contact name", "poc", "point of contact"] },
  { key: "contact_email", label: "Contact email", synonyms: ["contact email", "email"] },
  { key: "contact_title", label: "Contact title", synonyms: ["contact title", "designation", "title of contact"] },
  { key: "next_step", label: "Next step", synonyms: ["next step", "next action", "remarks"] },
] as const;

export function autoMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[_-]+/g, " "));
  for (const f of IMPORT_FIELDS) {
    const idx = norm.findIndex((h, i) => !Object.values(map).includes(i) && (h === f.key.replace(/_/g, " ") || (f.synonyms as readonly string[]).includes(h)));
    if (idx >= 0) map[f.key] = idx;
  }
  return map;
}

export const TEMPLATE_CSV = `Account,Deal name,Amount,Stage,Expected close date,Owner email,Lead source,Product,Contact name,Contact email,Contact title,Next step
Rajmahal Foods Pvt Ltd,Rajmahal – ERP rollout,18 L,Discovery,15/01/2027,priya@sahyadritech.in,Referral,ERP implementation,Sunita Agarwal,sunita@rajmahalfoods.in,CFO,Book discovery workshop
Vasant Kunj Clinics,Clinic network – Data platform,"42,00,000",Proposal,28/12/2026,arjun@sahyadritech.in,Website,Data & analytics,Dr. Arvind Mehra,arvind@vkclinics.in,Managing Director,Send revised proposal
Satpura Steel Ltd,Plant monitoring cloud migration,1.2 Cr,Qualified,2027-02-20,kavya@sahyadritech.in,LinkedIn,Cloud migration,Rakesh Tiwari,,Head of IT,Confirm budget with CFO
`;
