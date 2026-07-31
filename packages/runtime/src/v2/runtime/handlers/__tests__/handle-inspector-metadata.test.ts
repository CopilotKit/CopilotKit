import type { InspectorMetadataV1 } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import { CopilotRuntime } from "../../core/runtime";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import { handleInspectorMetadata } from "../handle-inspector-metadata";

const PRIVATE_NO_STORE = "no-store, private";

function createMetadata(): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    identity: { organizationName: "Acme", projectName: "Support" },
    plan: { code: "enterprise", label: "Enterprise" },
    license: { state: "valid" },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/organization/billing",
    },
    usage: {
      used: 41,
      limit: { kind: "finite", value: 100 },
    },
  };
}

function setupIntelligenceRuntime() {
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "https://api.example.com",
    wsUrl: "wss://ws.example.com",
    apiKey: "server-api-key",
  });
  const runtime = new CopilotRuntime({
    agents: {},
    intelligence,
    identifyUser: async () => ({ id: "user-1", name: "User One" }),
  });
  const request = new Request("https://runtime.example/inspector-metadata", {
    method: "GET",
    headers: { Authorization: "Bearer browser-token" },
  });

  return { intelligence, request, runtime };
}

function replaceMetadataProvider(
  intelligence: CopilotKitIntelligence,
  provider: () => Promise<unknown>,
) {
  const getInspectorMetadata = vi.fn(provider);
  Object.defineProperty(intelligence, "getInspectorMetadata", {
    configurable: true,
    value: getInspectorMetadata,
  });
  return getInspectorMetadata;
}

test("handle-inspector-metadata returns valid trusted metadata with private no-store caching", async () => {
  const { intelligence, request, runtime } = setupIntelligenceRuntime();
  const metadata = createMetadata();
  const getInspectorMetadata = replaceMetadataProvider(
    intelligence,
    async () => metadata,
  );

  const response = await handleInspectorMetadata({ runtime, request });

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/json");
  expect(response.headers.get("Cache-Control")).toBe(PRIVATE_NO_STORE);
  await expect(response.json()).resolves.toEqual(metadata);
  expect(getInspectorMetadata).toHaveBeenCalledWith();
});

test("handle-inspector-metadata sanitizes bad typed provider data at its boundary", async () => {
  const { intelligence, request, runtime } = setupIntelligenceRuntime();
  replaceMetadataProvider(intelligence, async () => ({
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: "Support",
      organizationId: "private-org-id",
    },
    usage: {
      used: -1,
      limit: { kind: "finite", value: 0 },
    },
    secret: "do-not-forward",
  }));

  const response = await handleInspectorMetadata({ runtime, request });

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe(PRIVATE_NO_STORE);
  await expect(response.json()).resolves.toEqual({
    schemaVersion: 1,
    identity: { organizationName: "Acme", projectName: "Support" },
  });
});

test("handle-inspector-metadata returns private 204 when metadata is absent", async () => {
  const { intelligence, request, runtime } = setupIntelligenceRuntime();
  replaceMetadataProvider(intelligence, async () => undefined);

  const response = await handleInspectorMetadata({ runtime, request });

  expect(response.status).toBe(204);
  expect(response.headers.get("Cache-Control")).toBe(PRIVATE_NO_STORE);
  await expect(response.text()).resolves.toBe("");
});

test("handle-inspector-metadata returns private 204 for invalid or unknown schemas", async () => {
  const invalidPayloads = [null, { schemaVersion: 2 }, { schemaVersion: "1" }];

  for (const payload of invalidPayloads) {
    const { intelligence, request, runtime } = setupIntelligenceRuntime();
    replaceMetadataProvider(intelligence, async () => payload);

    const response = await handleInspectorMetadata({ runtime, request });

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe(PRIVATE_NO_STORE);
    await expect(response.text()).resolves.toBe("");
  }
});

test("handle-inspector-metadata returns private 204 for a non-Intelligence runtime", async () => {
  const runtime = new CopilotRuntime({ agents: {} });
  const request = new Request("https://runtime.example/inspector-metadata", {
    method: "GET",
  });

  const response = await handleInspectorMetadata({ runtime, request });

  expect(response.status).toBe(204);
  expect(response.headers.get("Cache-Control")).toBe(PRIVATE_NO_STORE);
  await expect(response.text()).resolves.toBe("");
});

test("handle-inspector-metadata isolates provider failures behind a private 204", async () => {
  const { intelligence, request, runtime } = setupIntelligenceRuntime();
  replaceMetadataProvider(intelligence, async () => {
    throw new Error("provider unavailable");
  });

  const response = await handleInspectorMetadata({ runtime, request });

  expect(response.status).toBe(204);
  expect(response.headers.get("Cache-Control")).toBe(PRIVATE_NO_STORE);
  await expect(response.text()).resolves.toBe("");
});
