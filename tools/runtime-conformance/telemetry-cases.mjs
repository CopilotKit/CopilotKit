import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

/** Execute a durable run while leaving private content as a leak sentinel. */
async function run(context, extra = {}) {
  const body = {
    threadId: randomUUID(),
    runId: randomUUID(),
    messages: [
      { id: randomUUID(), role: "user", content: "private-prompt-sentinel" },
    ],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...extra,
  };
  assert.equal(
    (await context.request("POST", "/agent/default/run", body)).status,
    200,
  );
  await context.platform.waitFor(() =>
    context.platform.events.some(
      (event) =>
        event.runId === body.runId &&
        ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
    ),
  );
  return body;
}

/** Require canonical anonymous analytics with native package attribution. */
function envelope(event) {
  assert.ok(
    Number.isInteger(event.ts) && Math.abs(event.ts - Date.now() / 1000) < 30,
    "Telemetry timestamp must be Unix seconds",
  );
  assert.equal(typeof event.package.name, "string");
  assert.equal(typeof event.package.version, "string");
  assert.equal(event.global_properties.sampleRate, 1);
  assert.equal(event.global_properties.sampleRateAdjustmentFactor, 0);
  assert.equal(event.global_properties.sampleWeight, 1);
  assert.equal(event.global_properties.telemetry_transport, "lambda");
}

export const telemetryCases = [
  {
    id: "telemetry.canonical-events-and-envelope",
    async run(context) {
      const body = await run(context);
      await context.platform.waitFor(() =>
        context.platform.telemetry.some(
          (event) => event.event === "oss.runtime.agent_execution_stream_ended",
        ),
      );
      assert.equal(
        (
          await context.request("POST", "/agent/default/connect", {
            ...body,
            messages: [],
          })
        ).status,
        200,
      );
      await context.request("GET", "/info");
      await context.platform.waitFor(
        () =>
          context.platform.telemetry.filter(
            (event) => event.event === "oss.runtime.copilot_request_created",
          ).length >= 2,
      );
      const events = context.platform.telemetry;
      const instance = events.find(
        (event) => event.event === "oss.runtime.instance_created",
      );
      assert.deepEqual(instance.properties, {
        actionsAmount: 0,
        endpointTypes: [],
        endpointsAmount: 0,
        agentsAmount: 1,
        "cloud.api_key_provided": false,
      });
      const requests = events.filter(
        (event) => event.event === "oss.runtime.copilot_request_created",
      );
      assert.deepEqual(
        requests.map((event) => event.properties.requestType).sort(),
        ["connect", "run"],
      );
      for (const event of requests)
        assert.deepEqual(event.properties, {
          requestType: event.properties.requestType,
          "cloud.guardrails.enabled": false,
          "cloud.api_key_provided": false,
        });
      for (const event of events) envelope(event);
      for (const name of ["started", "ended"])
        assert.deepEqual(
          events.find(
            (event) =>
              event.event === `oss.runtime.agent_execution_stream_${name}`,
          ).properties,
          {},
        );
      assert.equal(
        events.some((event) => event.event.endsWith("errored")),
        false,
      );
      const encoded = JSON.stringify(events);
      for (const secret of [
        "private-prompt-sentinel",
        context.platform.apiKey,
        body.threadId,
        body.runId,
      ])
        assert.equal(encoded.includes(secret), false);
    },
  },
  ...[
    ["explicit-disable", { telemetryDisabled: true }, {}],
    [
      "zero-sample",
      { telemetrySampleRate: 0, telemetryId: "identified-but-not-exempt" },
      {},
    ],
    [
      "environment-rate-wins",
      { telemetrySampleRate: 1 },
      { COPILOTKIT_TELEMETRY_SAMPLE_RATE: "0" },
    ],
    ...["DO_NOT_TRACK", "COPILOTKIT_TELEMETRY_DISABLED"].flatMap((name) =>
      ["true", "1"].map((value) => [
        `${name.toLowerCase()}-${value}`,
        {},
        { [name]: value },
      ]),
    ),
  ].map(([name, configuration, environment]) => ({
    id: `telemetry.opt-out-${name}`,
    configuration,
    environment,
    async run(context) {
      await run(context);
      await delay(150);
      assert.equal(
        context.platform.telemetry.length,
        0,
        "Opt-out still exported analytics",
      );
    },
  })),
  {
    id: "telemetry.identity-is-header-only",
    configuration: { telemetryId: "  native_fixture_identity\t" },
    async run(context) {
      await run(context);
      await context.platform.waitFor(() =>
        context.platform.telemetry.some((event) =>
          event.event.endsWith("stream_ended"),
        ),
      );
      const requests = context.platform.requests.filter(
        (request) => request.path === "/telemetry",
      );
      assert.ok(requests.length > 0);
      for (const request of requests)
        assert.equal(
          request.headers["x-copilotkit-telemetry-id"],
          "native_fixture_identity",
        );
      assert.equal(
        JSON.stringify(context.platform.telemetry).includes(
          "native_fixture_identity",
        ),
        false,
      );
      // This flag means license-authorized sampling bypass, not header presence.
      assert.ok(
        context.platform.telemetry.every(
          (event) => event.global_properties.telemetry_identified === false,
        ),
      );
    },
  },
  {
    id: "telemetry.environment-identity",
    environment: { CPK_TELEMETRY_ID: "environment_fixture_identity" },
    async run(context) {
      await run(context);
      await context.platform.waitFor(() =>
        context.platform.telemetry.some((event) =>
          event.event.endsWith("stream_ended"),
        ),
      );
      assert.ok(
        context.platform.requests
          .filter((request) => request.path === "/telemetry")
          .every(
            (request) =>
              request.headers["x-copilotkit-telemetry-id"] ===
              "environment_fixture_identity",
          ),
      );
    },
  },
  {
    id: "telemetry.error-content-is-private",
    async run(context) {
      context.platform.faults.agentEvents = (body) => [
        { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
        {
          type: "RUN_ERROR",
          message: "upstream-secret-sentinel",
          code: "UNTRUSTED_UPSTREAM",
        },
      ];
      await run(context);
      await context.platform.waitFor(() =>
        context.platform.telemetry.some((event) =>
          event.event.endsWith("stream_errored"),
        ),
      );
      const events = context.platform.telemetry;
      assert.equal(
        events.some((event) => event.event.endsWith("stream_ended")),
        false,
      );
      assert.equal(
        JSON.stringify(events).includes("upstream-secret-sentinel"),
        false,
      );
      assert.equal(
        JSON.stringify(events).includes("UNTRUSTED_UPSTREAM"),
        false,
      );
      const error = events.find((event) =>
        event.event.endsWith("stream_errored"),
      ).properties;
      assert.deepEqual(Object.keys(error), ["error"]);
      assert.match(error.error, /^[A-Z_]+$/);
    },
  },
];
