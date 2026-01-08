import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createFetchRequestFromExpress } from "../endpoints/express-utils";

describe("createFetchRequestFromExpress abort behavior", () => {
  it("does not abort when the request ends normally", async () => {
    const app = express();

    app.post("/check", async (req, res) => {
      const request = createFetchRequestFromExpress(req);
      await new Promise((resolve) => setTimeout(resolve, 20));
      res.json({ aborted: request.signal.aborted });
    });

    const response = await request(app)
      .post("/check")
      .set("Content-Type", "application/json")
      .send({ hello: "world" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ aborted: false });
  });
});
