import { expect, test } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";

test("managed adapter exposes strict component create and replace paths", () => {
  expect(DeliveryAdapter.prototype).toHaveProperty(
    "postComponent",
    expect.any(Function),
  );
  expect(DeliveryAdapter.prototype).toHaveProperty(
    "updateComponent",
    expect.any(Function),
  );
});

test("managed adapter resolves component cadence from the active provider", () => {
  const adapter = new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });

  expect(adapter.getComponentDeliveryPolicy("slack")).toMatchObject({
    minIntervalMs: 800,
    maxAttempts: 3,
  });
  expect(adapter.getComponentDeliveryPolicy("teams")).toMatchObject({
    minIntervalMs: 700,
    maxAttempts: 3,
  });
});
