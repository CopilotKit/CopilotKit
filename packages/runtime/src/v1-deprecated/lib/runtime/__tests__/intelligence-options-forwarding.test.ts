import { createChannel } from "@copilotkit/channels";
import { expect, test, vi } from "vitest";

import { CopilotKitIntelligence } from "../../../../v2/runtime";
import { CopilotRuntime } from "../copilot-runtime";

test("forwards Intelligence options through the package-root runtime", () => {
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-api-key",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://intelligence.example",
  });
  const identifyUser = vi
    .fn()
    .mockResolvedValue({ id: "user-1", name: "User One" });
  const memory = {
    access: vi.fn().mockResolvedValue({
      user: "read-write" as const,
      project: "read" as const,
    }),
  };
  const learning = { containerId: "support-quality" };
  const channels = [
    createChannel({ name: "support", identifyUser: "platform" }),
  ];

  const runtime = new CopilotRuntime({
    agents: {},
    intelligence,
    identifyUser,
    memory,
    channels,
    ɵlearning: learning,
    generateThreadNames: false,
    maxReconnectMs: 2_500,
    maxRejoinMs: 3_500,
    lockTtlSeconds: 45,
    lockKeyPrefix: "test-lock",
    lockHeartbeatIntervalSeconds: 12,
    exposeMemoryRoutes: true,
  }).instance;

  expect(runtime.mode).toBe("intelligence");
  expect(runtime.intelligence).toBe(intelligence);
  expect(runtime.identifyUser).toBe(identifyUser);
  expect(runtime.memory).toBe(memory);
  expect(runtime.channels).toEqual(channels);
  expect(runtime.learning).toBe(learning);
  expect(runtime.generateThreadNames).toBe(false);
  expect(runtime.lockTtlSeconds).toBe(45);
  expect(runtime.lockKeyPrefix).toBe("test-lock");
  expect(runtime.lockHeartbeatIntervalSeconds).toBe(12);
  expect(runtime.exposeMemoryRoutes).toBe(true);
  expect(Reflect.get(runtime.runner, "options")).toMatchObject({
    maxReconnectMs: 2_500,
    maxRejoinMs: 3_500,
  });
});
