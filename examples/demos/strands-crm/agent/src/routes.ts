import express from "express";
import type { Express } from "express";
import { crm } from "./crm/store.js";
import { isValidStage } from "./crm/types.js";

/** Mount read + direct-edit CRM routes on an existing Express app.
 *  These power UI-initiated edits (drag/drop, quick actions) against the
 *  same store the agent tools mutate — one source of truth. */
export function registerCrmRoutes(app: Express): void {
  const json = express.json();

  app.get("/crm", (_req, res) => {
    res.json(crm.getStateSnapshot());
  });

  app.post("/crm/deals/:id/stage", json, (req, res) => {
    const { stage } = req.body ?? {};
    if (typeof stage !== "string" || !isValidStage(stage)) {
      return res.status(400).json({ error: "invalid stage" });
    }
    try {
      return res.json(crm.moveStage(req.params.id, stage));
    } catch (e) {
      return res.status(404).json({ error: (e as Error).message });
    }
  });

  app.post("/crm/deals/:id/won", json, (req, res) => {
    try {
      return res.json(crm.markWon(req.params.id));
    } catch (e) {
      return res.status(404).json({ error: (e as Error).message });
    }
  });

  // Persist an approved hardware quote (from the copilot's QuoteCard "Approve").
  // Returns the saved quote (with a server-assigned id) so the UI can route to
  // the full quote page, which reads it from the shared snapshot.
  app.post("/crm/quotes", json, (req, res) => {
    const b = req.body ?? {};
    if (!Array.isArray(b.lineItems) || b.lineItems.length === 0) {
      return res.status(400).json({ error: "lineItems required" });
    }
    if (typeof b.accountName !== "string" || b.accountName.length === 0) {
      return res.status(400).json({ error: "accountName required" });
    }
    const subtotal =
      typeof b.subtotal === "number"
        ? b.subtotal
        : b.lineItems.reduce(
            (
              s: number,
              it: { lineTotal?: number; qty?: number; unitPrice?: number },
            ) => s + (it.lineTotal ?? (it.qty ?? 0) * (it.unitPrice ?? 0)),
            0,
          );
    const quote = crm.addQuote({
      accountId: typeof b.accountId === "string" ? b.accountId : "",
      accountName: b.accountName,
      useCase: typeof b.useCase === "string" ? b.useCase : undefined,
      seats: typeof b.seats === "number" ? b.seats : undefined,
      lineItems: b.lineItems,
      subtotal,
      note: typeof b.note === "string" ? b.note : undefined,
    });
    return res.json(quote);
  });
}
