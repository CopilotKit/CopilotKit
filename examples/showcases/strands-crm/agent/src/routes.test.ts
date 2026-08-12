import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { registerCrmRoutes } from "./routes.js";

function app() {
  const a = express();
  registerCrmRoutes(a);
  return a;
}

describe("CRM REST routes", () => {
  it("GET /crm returns the snapshot", async () => {
    const res = await request(app()).get("/crm");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.deals)).toBe(true);
  });

  it("POST /crm/deals/:id/stage moves a deal", async () => {
    const res = await request(app())
      .post("/crm/deals/d3/stage")
      .send({ stage: "Qualified" });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("Qualified");
  });

  it("POST /crm/deals/:id/stage rejects a bad stage", async () => {
    const res = await request(app())
      .post("/crm/deals/d3/stage")
      .send({ stage: "Nope" });
    expect(res.status).toBe(400);
  });

  it("POST /crm/deals/:id/won closes the deal", async () => {
    const res = await request(app()).post("/crm/deals/d1/won").send({});
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("Closed Won");
  });

  it("POST /crm/quotes creates a quote and returns it with an id", async () => {
    const res = await request(app())
      .post("/crm/quotes")
      .send({
        accountId: "a6",
        accountName: "CopilotKit",
        useCase: "fleet",
        seats: 30,
        lineItems: [
          {
            productId: "p1",
            name: "Northstar Pro 14",
            category: "Laptop",
            qty: 30,
            unitPrice: 1800,
            lineTotal: 54000,
            photoUrl: "x",
          },
        ],
        subtotal: 54000,
        note: "ok",
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^q\d+$/);
    expect(res.body.accountName).toBe("CopilotKit");
    expect(res.body.status).toBe("approved");
  });

  it("POST /crm/quotes rejects a payload with no line items", async () => {
    const res = await request(app()).post("/crm/quotes").send({
      accountId: "a6",
      accountName: "CopilotKit",
      lineItems: [],
      subtotal: 0,
    });
    expect(res.status).toBe(400);
  });
});
