import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { requireAuth } from "./auth.ts";
import { adminRouter, authRouter } from "./routes/admin.ts";
import { crmRouter } from "./routes/crm.ts";
import { dealsRouter } from "./routes/deals.ts";
import { intelRouter } from "./routes/intel.ts";
import { HttpError } from "./validate.ts";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", authRouter);
  app.use("/api", requireAuth, adminRouter, dealsRouter, crmRouter, intelRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  const dist = resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: "Malformed request body" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server" });
  });
  return app;
}
