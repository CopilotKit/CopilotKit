/**
 * Integration test: Express adapter + telemetry.
 */
import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

import { telemetry } from "../telemetry";
import { createCopilotExpressHandler } from "../endpoints/express";
import { CopilotRuntime } from "../core/runtime";

function makeAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

function makeRuntime() {
  const runner = {
    run: () =>
      new Observable((observer) => {
        observer.next({});
        observer.complete();
        return () => undefined;
      }),
    connect: () => of({}),
    stop: async () => true,
  };
  return new CopilotRuntime({
    agents: { default: makeAgent() },
    runner,
  });
}

describe("Express adapter — telemetry firing (integration)", () => {
  let captureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  it("fires instance_created on handler creation (multi-route)", async () => {
    const runtime = makeRuntime();
    createCopilotExpressHandler({ runtime, basePath: "/" });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.instance_created",
        expect.objectContaining({
          agentsAmount: 1,
          "cloud.api_key_provided": false,
        }),
      );
    });
  });

  it("fires copilot_request_created when a real HTTP request hits the handler", async () => {
    const runtime = makeRuntime();
    const app = express();
    app.use(createCopilotExpressHandler({ runtime, basePath: "/" }));

    await request(app)
      .post("/agent/default/run")
      .set("Content-Type", "application/json")
      .send({ messages: [], state: {}, threadId: "t1" });

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.copilot_request_created",
      expect.objectContaining({
        requestType: "run",
        "cloud.api_key_provided": false,
      }),
    );
  });

  it("includes cloud.public_api_key on request when header is present", async () => {
    const runtime = makeRuntime();
    const app = express();
    app.use(createCopilotExpressHandler({ runtime, basePath: "/" }));

    await request(app)
      .post("/agent/default/run")
      .set("Content-Type", "application/json")
      .set("x-copilotcloud-public-api-key", "ck_pub_test_xyz")
      .send({ messages: [], state: {}, threadId: "t1" });

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.copilot_request_created",
      expect.objectContaining({
        "cloud.api_key_provided": true,
        "cloud.public_api_key": "ck_pub_test_xyz",
      }),
    );
  });
});
