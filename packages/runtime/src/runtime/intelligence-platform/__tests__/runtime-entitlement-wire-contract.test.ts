import type { RuntimeEntitlementResponse } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import {
  READY_RUNTIME_ENTITLEMENTS,
  UNAVAILABLE_RUNTIME_ENTITLEMENTS,
} from "../../__tests__/runtime-entitlement-test-utils";
import { CopilotKitIntelligence } from "../client";

/** Create an isolated client and fetch stub for one wire-contract test. */
function setup() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  return {
    createClient: () =>
      new CopilotKitIntelligence({
        apiUrl: "https://api.example.com",
        wsUrl: "wss://ws.example.com/socket",
        apiKey: "cpk-project-key",
      }),
    fetchMock,
    teardown: () => vi.unstubAllGlobals(),
  };
}

test("getRuntimeEntitlements accepts the published App API response union", async () => {
  const publishedResponses: readonly RuntimeEntitlementResponse[] = [
    READY_RUNTIME_ENTITLEMENTS,
    UNAVAILABLE_RUNTIME_ENTITLEMENTS,
  ];
  const { createClient, fetchMock, teardown } = setup();

  try {
    for (const response of publishedResponses) {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      await expect(client.getRuntimeEntitlements()).resolves.toEqual(response);
    }
  } finally {
    teardown();
  }
});
