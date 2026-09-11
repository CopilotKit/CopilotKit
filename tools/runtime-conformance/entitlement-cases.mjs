import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const path = "/api/entitlements/runtime";
const ready = {
  status: "ready",
  entitlement: {
    active: true,
    source: "managedOrgSubscription",
    features: { memory: true, learning: false },
    limits: { threads: 100, fraction: 2.5, zero: 0 },
    planCode: "",
    entitlementSource: "subscription",
  },
};

/** Supply a response through the existing authenticated platform fault fixture. */
function respond(platform, status, body, delayMs = 0) {
  platform.faults.http.set(`GET ${path}`, { status, body, delayMs });
}

/** Read only the entitlement requests, excluding discovery's other platform work. */
function calls(platform) {
  return platform.requests.filter((request) => request.path === path);
}

/** Require the published entitlement projection and its compatibility license state. */
function matches(response, entitlement, licenseStatus) {
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.runtimeEntitlements,
    entitlement,
    "entitlements must match the platform contract",
  );
  assert.equal(response.body.licenseStatus, licenseStatus);
}

/** Produce the safe discovery diagnostic used by the TypeScript handler. */
function failure(retryable) {
  return {
    status: retryable ? "unavailable" : "misconfigured",
    error: {
      code: retryable
        ? "runtime_entitlements_unavailable"
        : "runtime_entitlements_misconfigured",
      message: retryable
        ? "Runtime entitlement lookup failed"
        : "Runtime entitlement lookup is misconfigured",
      retryable,
    },
  };
}

/** Exercise SDK-backed discovery with the same socket cases in every language. */
export const entitlementCases = [
  {
    id: "entitlements.current",
    async run({ request, platform }) {
      respond(platform, 200, ready, 100);
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request("GET", "/info", undefined, {
            authorization: "Bearer browser-secret",
            cookie: "session=browser-secret",
            "x-test-user-id": "",
            "x-cpki-user-id": "spoofed-user",
          }),
        ),
      );
      for (const response of responses) matches(response, ready, "valid");
      matches(await request("GET", "/info"), ready, "valid");
      const upstream = calls(platform);
      assert.equal(
        upstream.length,
        1,
        "concurrent and repeated discovery reads share one SDK lookup",
      );
      assert.equal(upstream[0].method, "GET");
      assert.equal(upstream[0].body, undefined);
      assert.deepEqual(upstream[0].query, {});
      assert.equal(
        upstream[0].headers.authorization,
        `Bearer ${platform.apiKey}`,
      );
      assert.equal(upstream[0].headers.cookie, undefined);
      assert.equal(upstream[0].headers["x-cpki-user-id"], undefined);
    },
  },
  {
    id: "entitlements.legacy",
    async run({ request, platform }) {
      const entitlement = {
        ...ready.entitlement,
        source: "awsMarketplaceDeploymentLicense",
      };
      respond(platform, 200, {
        ...entitlement,
        organizationId: "private-organization",
      });
      matches(
        await request("GET", "/info"),
        { status: "ready", entitlement },
        "valid",
      );
    },
  },
  ...["degraded", "misconfigured", "unavailable"].map((status) => ({
    id: `entitlements.structured-${status}`,
    async run({ request, platform }) {
      const response = {
        status,
        error: {
          code: "BUSY",
          message: "Try later",
          retryable: status !== "misconfigured",
          requestId: "",
          traceId: "trace",
        },
      };
      respond(platform, 200, response);
      matches(
        await request("GET", "/info"),
        response,
        response.error.retryable ? "unknown" : "none",
      );
      matches(
        await request("GET", "/info"),
        response,
        response.error.retryable ? "unknown" : "none",
      );
      assert.equal(calls(platform).length, 1);
    },
  })),
  ...[
    ["null", null],
    [
      "missing-active",
      {
        status: "ready",
        entitlement: {
          source: "managedOrgSubscription",
          features: {},
          limits: {},
        },
      },
    ],
    [
      "feature-type",
      {
        ...ready,
        entitlement: { ...ready.entitlement, features: { memory: 1 } },
      },
    ],
    [
      "null-limit",
      {
        ...ready,
        entitlement: { ...ready.entitlement, limits: { threads: null } },
      },
    ],
    ["unknown-field", { ...ready, extra: "private-provider-content" }],
    [
      "unknown-source",
      { ...ready, entitlement: { ...ready.entitlement, source: "unknown" } },
    ],
    [
      "null-plan",
      { ...ready, entitlement: { ...ready.entitlement, planCode: null } },
    ],
  ].map(([name, body]) => ({
    id: `entitlements.malformed-${name}`,
    async run({ request, platform }) {
      respond(platform, 200, body);
      matches(await request("GET", "/info"), failure(false), "none");
      matches(await request("GET", "/info"), failure(false), "none");
      assert.equal(
        calls(platform).length,
        1,
        "schema failures share the SDK's failure cache",
      );
    },
  })),
  ...[401, 408, 425, 429, 503].map((status) => ({
    id: `entitlements.http-${status}`,
    async run({ request, platform }) {
      respond(platform, status, { error: "private-provider-content" });
      matches(
        await request("GET", "/info"),
        failure(status !== 401),
        status === 401 ? "none" : "unknown",
      );
      matches(
        await request("GET", "/info"),
        failure(status !== 401),
        status === 401 ? "none" : "unknown",
      );
      assert.equal(
        calls(platform).length,
        1,
        "HTTP failures share the SDK's failure cache",
      );
    },
  })),
  {
    id: "entitlements.deadline",
    async run({ request, platform }) {
      respond(platform, 200, ready, 4000);
      const started = performance.now();
      matches(await request("GET", "/info"), failure(true), "unknown");
      assert.ok(
        performance.now() - started < 3000,
        "the SDK must bound entitlement lookup at 1.5 seconds",
      );
    },
  },
  {
    id: "entitlements.body-deadline",
    async run({ request, platform }) {
      platform.faults.http.set(`GET ${path}`, {
        status: 200,
        body: ready,
        bodyDelayMs: 4000,
      });
      const started = performance.now();
      matches(await request("GET", "/info"), failure(true), "unknown");
      assert.ok(
        performance.now() - started < 3000,
        "the entitlement deadline must include the response body",
      );
      matches(await request("GET", "/info"), failure(true), "unknown");
      assert.equal(
        calls(platform).length,
        1,
        "body timeouts share the safe failure cache",
      );
    },
  },
  ...[
    "managedOrgSubscription",
    "selfHostedDeploymentLicense",
    "awsMarketplaceDeploymentLicense",
  ].map((source) => ({
    id: `entitlements.inactive-${source}`,
    async run({ request, platform }) {
      const response = {
        status: "ready",
        entitlement: { ...ready.entitlement, active: false, source },
      };
      respond(platform, 200, response);
      matches(await request("GET", "/info"), response, "none");
      respond(platform, 503, { error: "private-provider-content" });
      matches(await request("GET", "/info"), response, "none");
      assert.equal(calls(platform).length, 1);
      await delay(5100);
      matches(await request("GET", "/info"), failure(true), "unknown");
      assert.equal(
        calls(platform).length,
        2,
        "inactive grants expire after five seconds",
      );
    },
  })),
  {
    id: "entitlements.cache-expiry",
    async run({ request, platform }) {
      respond(platform, 200, ready);
      matches(await request("GET", "/info"), ready, "valid");
      respond(platform, 503, { error: "private-provider-content" });
      await delay(6000);
      matches(await request("GET", "/info"), ready, "valid");
      assert.equal(
        calls(platform).length,
        1,
        "active grants must outlive the five-second negative cache",
      );
      await delay(25000);
      matches(await request("GET", "/info"), failure(true), "unknown");
      assert.equal(
        calls(platform).length,
        2,
        "expired active authority must not survive a failed refresh",
      );
      respond(platform, 200, ready);
      matches(await request("GET", "/info"), failure(true), "unknown");
      assert.equal(calls(platform).length, 2);
      await delay(5100);
      matches(await request("GET", "/info"), ready, "valid");
      assert.equal(
        calls(platform).length,
        3,
        "failures expire after five seconds",
      );
    },
  },
];
