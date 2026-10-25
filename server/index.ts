import { createApp } from "./app.ts";
import { get } from "./db.ts";
import { seed } from "./seed.ts";

const PORT = Number(process.env.PORT ?? 4000);

if (!get("SELECT id FROM organizations LIMIT 1")) {
  console.log("No data found — loading synthetic demo data…");
  seed();
}

createApp().listen(PORT, () => console.log(`MNT Revenue API on http://localhost:${PORT}`));
