import assert from "node:assert/strict";

const platformPath = "/api/inspector/metadata";
const route = "/inspector-metadata";

/** Require private responses for both displayed and absent account metadata. */
function privateResponse(response) {
  assert.match(
    response.headers.get("cache-control") ?? "",
    /\bno-store\b/,
    "private metadata must disable storage",
  );
  assert.match(response.headers.get("cache-control") ?? "", /\bprivate\b/);
}

/** Require absence without a JSON body or a provider error envelope. */
function absentResponse(response) {
  privateResponse(response);
  assert.equal(response.status, 204);
  assert.equal(response.body, undefined);
  assert.equal(response.headers.get("content-type"), null);
}

/** Use the existing authenticated fault fixture to supply a platform response. */
function metadataResponse(platform, status, body, delayMs = 0) {
  platform.faults.http.set(`GET ${platformPath}`, { status, body, delayMs });
}

/** Match the TypeScript metadata parser, SDK deadline, and public display handler. */
export const inspectorCases = [
  {
    id: "inspector.discovery",
    async run({ request, platform }) {
      const response = await request("GET", "/info");
      assert.equal(response.status, 200);
      assert.equal(response.body.inspectorMetadata, true);
      assert.equal(
        platform.requests.filter((entry) => entry.path === platformPath).length,
        0,
      );
    },
  },
  {
    id: "inspector.metadata-sanitized",
    async run({ request, platform }) {
      metadataResponse(platform, 200, {
        schemaVersion: 1,
        identity: {
          organizationName: "\ufeff Org ",
          projectName: " Project ",
          secret: "discard",
        },
        plan: { code: " pro ", label: " Pro " },
        license: { state: "valid" },
        action: { kind: "manage_plan", url: " https://example.com/plans " },
        usage: {
          used: 0,
          limit: { kind: "finite", value: 100 },
          expiringSoonCount: 0,
        },
        secret: "provider-secret-payload",
      });

      const response = await request("GET", route, undefined, {
        authorization: "Bearer browser-secret",
        cookie: "session=browser-secret",
        "x-test-user-id": "",
        "x-cpki-user-id": "spoofed-user",
      });

      privateResponse(response);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, {
        schemaVersion: 1,
        identity: { organizationName: "Org", projectName: "Project" },
        plan: { code: "pro", label: "Pro" },
        license: { state: "valid" },
        action: { kind: "manage_plan", url: "https://example.com/plans" },
        usage: {
          used: 0,
          limit: { kind: "finite", value: 100 },
          expiringSoonCount: 0,
        },
      });
      const upstream = platform.requests.filter(
        (entry) => entry.path === platformPath,
      );
      assert.equal(upstream.length, 1);
      assert.equal(upstream[0].method, "GET");
      assert.deepEqual(upstream[0].query, {});
      assert.equal(upstream[0].body, undefined);
      assert.equal(
        upstream[0].headers.authorization,
        `Bearer ${platform.apiKey}`,
      );
      assert.equal(upstream[0].headers.cookie, undefined);
      assert.equal(upstream[0].headers["x-cpki-user-id"], undefined);
    },
  },
  {
    id: "inspector.metadata-modules",
    async run({ request, platform }) {
      for (const [modules, expected] of [
        [
          {
            identity: { organizationName: " ", projectName: "Project" },
            plan: { code: "pro", label: "Pro" },
            license: { state: "bad" },
          },
          { plan: { code: "pro", label: "Pro" } },
        ],
        [
          {
            usage: {
              used: Number.MAX_SAFE_INTEGER,
              limit: { kind: "unknown", value: 9 },
              expiringSoonCount: -1,
            },
          },
          {
            usage: {
              used: Number.MAX_SAFE_INTEGER,
              limit: { kind: "unknown" },
            },
          },
        ],
        [
          { usage: { used: 0, limit: { kind: "unlimited" } } },
          { usage: { used: 0, limit: { kind: "unlimited" } } },
        ],
        [
          {
            usage: {
              used: Number.MAX_SAFE_INTEGER + 1,
              limit: { kind: "unlimited" },
            },
          },
          {},
        ],
        [{ usage: { used: true, limit: { kind: "finite", value: 10 } } }, {}],
        [{ usage: { used: 1, limit: { kind: "finite", value: 0 } } }, {}],
        [{ usage: { used: 1.5, limit: { kind: "finite", value: 10 } } }, {}],
      ]) {
        metadataResponse(platform, 200, { schemaVersion: 1, ...modules });
        const response = await request("GET", route);
        privateResponse(response);
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { schemaVersion: 1, ...expected });
      }
    },
  },
  {
    id: "inspector.metadata-action-urls",
    async run({ request, platform }) {
      const safe = [
        "https://example.com/plans",
        "http://localhost:8080/renew",
        "http://127.0.0.1/renew",
        "http://[::1]/renew",
      ];
      const unsafe = [
        "http://example.com",
        "https://example.com?",
        "https://example.com#",
        "https://@example.com",
        "https://user:password@example.com",
        "https://exa%20mple.com",
        "https://example.com:99999",
        "https://[invalid]",
        "javascript:alert(1)",
      ];
      for (const url of [...safe, ...unsafe]) {
        metadataResponse(platform, 200, {
          schemaVersion: 1,
          action: { kind: "renew", url },
          license: { state: "expired" },
        });
        const response = await request("GET", route);
        privateResponse(response);
        assert.equal(response.status, 200);
        assert.deepEqual(
          response.body,
          {
            schemaVersion: 1,
            license: { state: "expired" },
            ...(safe.includes(url) ? { action: { kind: "renew", url } } : {}),
          },
          url,
        );
      }
    },
  },
  {
    id: "inspector.metadata-absence-and-errors",
    async run({ request, platform }) {
      for (const [status, body] of [
        [204, undefined],
        [404, { error: "provider-secret-payload" }],
        [200, undefined],
        [200, null],
        [200, []],
        [200, "provider-secret-payload"],
        [200, { schemaVersion: 2 }],
        [200, { schemaVersion: "1" }],
        [401, { error: "provider-secret-payload" }],
        [403, {}],
        [429, {}],
        [503, {}],
      ]) {
        metadataResponse(platform, status, body);
        absentResponse(await request("GET", route));
      }
    },
  },
  {
    id: "inspector.metadata-deadline",
    async run({ request, platform }) {
      metadataResponse(platform, 200, { schemaVersion: 1 }, 8000);
      const start = performance.now();

      const response = await request("GET", route);

      absentResponse(response);
      assert.ok(
        performance.now() - start < 7000,
        "metadata must stop at its five-second deadline, before the late response",
      );
      assert.equal(
        platform.requests.filter((entry) => entry.path === platformPath).length,
        1,
      );
    },
  },
];
