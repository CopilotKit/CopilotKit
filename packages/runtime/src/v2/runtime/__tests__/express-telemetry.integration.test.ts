/**
 * Integration test: Express adapter + telemetry.
 */
import express from "express";
import request from "supertest";
import { expect, test, vi } from "vitest";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

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
      new Observable<BaseEvent>((observer) => {
        observer.next({} as BaseEvent);
        observer.complete();
        return () => undefined;
      }),
    connect: () => of({} as BaseEvent),
    isRunning: async () => false,
    stop: async () => true,
  };
  return new CopilotRuntime({
    agents: { default: makeAgent() },
    runner,
  });
}

/** Creates an isolated runtime and a spy on its bound telemetry capture. */
function setup() {
  const runtime = makeRuntime();
  const captureSpy = vi
    .spyOn(runtime.telemetry, "capture")
    .mockResolvedValue(undefined);

  return {
    runtime,
    captureSpy,
    teardown: () => captureSpy.mockRestore(),
  };
}

test("Express adapter fires instance_created on handler creation (multi-route)", async () => {
  const { runtime, captureSpy, teardown } = setup();

  try {
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
  } finally {
    teardown();
  }
});

test("Express adapter fires copilot_request_created for a real HTTP request", async () => {
  const { runtime, captureSpy, teardown } = setup();

  try {
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
  } finally {
    teardown();
  }
});

test("Express adapter includes cloud.public_api_key when the header is present", async () => {
  const { runtime, captureSpy, teardown } = setup();

  try {
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
  } finally {
    teardown();
  }
});
