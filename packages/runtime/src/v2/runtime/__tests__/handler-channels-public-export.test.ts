import { test, expect, vi } from "vitest";
// Import the handler factory through the package's PUBLIC `/v2` entry, whose
// source barrel is `src/v2/index.ts` (two levels up from this __tests__ dir).
// This is the specifier a consumer compiles down to when they write
// `import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2"`, so it
// exercises the full public re-export chain (v2 index -> runtime index ->
// core/fetch-handler) rather than the deep internal module. It locks the
// contract that the public surface still carries `handler.channels`.
//
// We import from the source barrel rather than the `@copilotkit/runtime/v2`
// package specifier on purpose: that specifier resolves to the gitignored,
// prebuilt `dist/`, which the `test` target does not rebuild and which can lag
// behind source — testing it would assert against a stale artifact.
import { createCopilotRuntimeHandler } from "../../index";
import type { CopilotRuntimeFetchHandler } from "../../index";
import { CopilotRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createChannel } from "@copilotkit/channels";
import type {
  ActivateChannelEngine,
  ChannelsHandle,
} from "../core/channel-manager";

/**
 * Build an Intelligence platform client for a fake managed runtime.
 *
 * @returns A configured {@link CopilotKitIntelligence} instance.
 */
const intelligence = () =>
  new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });

/**
 * Build an Intelligence runtime declaring a single managed Channel.
 *
 * @returns A {@link CopilotRuntime} with one channel and a fake identify hook.
 */
const intelRuntimeWith1Channel = () =>
  new CopilotRuntime({
    agents: {},
    intelligence: intelligence(),
    identifyUser: vi.fn().mockResolvedValue({ id: "u", name: "U" }),
    channels: [createChannel({ name: "support" })],
  });

/**
 * A no-op activation engine that resolves a {@link ChannelsHandle} without
 * opening any transport (test seam via the `__channelEngine` option).
 *
 * @returns A fake {@link ActivateChannelEngine}.
 */
const fakeChannelEngine =
  (): ActivateChannelEngine => async (): Promise<ChannelsHandle> => ({
    metadata: {},
    stop: async () => {},
  });

test("public /v2 entry exposes handler.channels for an intelligence+channels runtime", async () => {
  const handler: CopilotRuntimeFetchHandler = createCopilotRuntimeHandler({
    runtime: intelRuntimeWith1Channel(),
    __channelEngine: fakeChannelEngine(),
  });

  expect(handler.channels).toBeDefined();
  await handler.channels!.ready({ timeoutMs: 1000 });
  expect(handler.channels!.status().overall).toBe("online");

  await handler.channels!.stop();
});

test("public /v2 entry omits handler.channels for a plain runtime", () => {
  const handler = createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({ agents: {} }),
    __channelEngine: fakeChannelEngine(),
  });

  expect(handler.channels).toBeUndefined();
});
