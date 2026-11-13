import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
// Import through the public source barrels, so the test covers the names that
// consumers import from `@copilotkit/runtime` and `@copilotkit/runtime/node`.
import {
  createCopilotKitRuntimeHandler,
  createCopilotRuntimeHandler,
} from "../../index";
import * as runtimeEntry from "../../index";
import type {
  CopilotCorsConfig,
  CopilotIntelligenceRuntimeLike,
  CopilotIntelligenceRuntimeOptions,
  CopilotKitCorsConfig,
  CopilotKitIntelligenceRuntimeLike,
  CopilotKitIntelligenceRuntimeOptions,
  CopilotKitRuntimeConstructor,
  CopilotKitRuntimeFetchHandler,
  CopilotKitRuntimeFetchHandlerWithChannels,
  CopilotKitRuntimeHandlerOptions,
  CopilotKitRuntimeHooks,
  CopilotKitRuntimeLearningConfig,
  CopilotKitRuntimeLearningContext,
  CopilotKitRuntimeLike,
  CopilotKitRuntimeLogger,
  CopilotKitRuntimeMemoryConfig,
  CopilotKitRuntimeOptions,
  CopilotKitRuntimeUser,
  CopilotKitSseRuntimeLike,
  CopilotKitSseRuntimeOptions,
  CopilotRuntimeConstructor,
  CopilotRuntimeFetchHandler,
  CopilotRuntimeFetchHandlerWithChannels,
  CopilotRuntimeHandlerOptions,
  CopilotRuntimeHooks,
  CopilotRuntimeLearningConfig,
  CopilotRuntimeLearningContext,
  CopilotRuntimeLike,
  CopilotRuntimeLogger,
  CopilotRuntimeMemoryConfig,
  CopilotRuntimeOptions,
  CopilotRuntimeUser,
  CopilotSseRuntimeLike,
  CopilotSseRuntimeOptions,
} from "../../index";
import {
  createCopilotKitNodeHandler,
  createCopilotKitNodeListener,
  createCopilotNodeHandler,
  createCopilotNodeListener,
} from "../../node";
import type {
  NodeCopilotKitListener,
  NodeCopilotKitListenerWithChannels,
  NodeCopilotListener,
  NodeCopilotListenerWithChannels,
} from "../../node";
import { CopilotKitRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import type {
  ActivateChannelEngine,
  ChannelsHandle,
} from "../core/channel-manager";

const fakeChannelEngine =
  (): ActivateChannelEngine => async (): Promise<ChannelsHandle> => ({
    metadata: {},
    stop: async () => {},
  });

const runtimeWithChannel = () =>
  new CopilotKitRuntime({
    agents: {},
    intelligence: new CopilotKitIntelligence({
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
      apiKey: "cpk-42_short_long",
    }),
    identifyUser: vi.fn().mockResolvedValue({ id: "u", name: "U" }),
    channels: [createChannel({ identifyUser: "platform", name: "support" })],
  });

const infoRequest = () => new Request("http://localhost/api/info");

async function getInfo(
  listener: Parameters<typeof createServer>[1],
): Promise<unknown> {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/info`);
    expect(response.status).toBe(200);
    return await response.json();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("deprecated runtime names", () => {
  test("the old class names are the CopilotKit classes", () => {
    expect(runtimeEntry.CopilotRuntime).toBe(runtimeEntry.CopilotKitRuntime);
    expect(runtimeEntry.CopilotSseRuntime).toBe(
      runtimeEntry.CopilotKitSseRuntime,
    );
    expect(runtimeEntry.CopilotIntelligenceRuntime).toBe(
      runtimeEntry.CopilotKitIntelligenceRuntime,
    );
  });

  test("a runtime built with an old name is an instance of the new name", () => {
    const runtime = new runtimeEntry.CopilotRuntime({ agents: {} });
    expect(runtime).toBeInstanceOf(runtimeEntry.CopilotKitRuntime);
    expectTypeOf(runtime).toEqualTypeOf<runtimeEntry.CopilotKitRuntime>();

    const sse = new runtimeEntry.CopilotSseRuntime({ agents: {} });
    expect(sse).toBeInstanceOf(runtimeEntry.CopilotKitSseRuntime);
  });

  test("the old type names are the CopilotKit types", () => {
    expectTypeOf<runtimeEntry.CopilotRuntime>().toEqualTypeOf<runtimeEntry.CopilotKitRuntime>();
    expectTypeOf<runtimeEntry.CopilotSseRuntime>().toEqualTypeOf<runtimeEntry.CopilotKitSseRuntime>();
    expectTypeOf<runtimeEntry.CopilotIntelligenceRuntime>().toEqualTypeOf<runtimeEntry.CopilotKitIntelligenceRuntime>();
    expectTypeOf<CopilotRuntimeConstructor>().toEqualTypeOf<CopilotKitRuntimeConstructor>();
    expectTypeOf<CopilotRuntimeOptions>().toEqualTypeOf<CopilotKitRuntimeOptions>();
    expectTypeOf<CopilotRuntimeLike>().toEqualTypeOf<CopilotKitRuntimeLike>();
    expectTypeOf<CopilotSseRuntimeOptions>().toEqualTypeOf<CopilotKitSseRuntimeOptions>();
    expectTypeOf<CopilotSseRuntimeLike>().toEqualTypeOf<CopilotKitSseRuntimeLike>();
    expectTypeOf<CopilotIntelligenceRuntimeOptions>().toEqualTypeOf<CopilotKitIntelligenceRuntimeOptions>();
    expectTypeOf<CopilotIntelligenceRuntimeLike>().toEqualTypeOf<CopilotKitIntelligenceRuntimeLike>();
    expectTypeOf<CopilotRuntimeMemoryConfig>().toEqualTypeOf<CopilotKitRuntimeMemoryConfig>();
    expectTypeOf<CopilotRuntimeUser>().toEqualTypeOf<CopilotKitRuntimeUser>();
    expectTypeOf<CopilotRuntimeLearningConfig>().toEqualTypeOf<CopilotKitRuntimeLearningConfig>();
    expectTypeOf<CopilotRuntimeLearningContext>().toEqualTypeOf<CopilotKitRuntimeLearningContext>();
    expectTypeOf<CopilotRuntimeLogger>().toEqualTypeOf<CopilotKitRuntimeLogger>();
    expectTypeOf<CopilotRuntimeHandlerOptions>().toEqualTypeOf<CopilotKitRuntimeHandlerOptions>();
    expectTypeOf<CopilotRuntimeFetchHandler>().toEqualTypeOf<CopilotKitRuntimeFetchHandler>();
    expectTypeOf<CopilotRuntimeFetchHandlerWithChannels>().toEqualTypeOf<CopilotKitRuntimeFetchHandlerWithChannels>();
    expectTypeOf<CopilotRuntimeHooks>().toEqualTypeOf<CopilotKitRuntimeHooks>();
    expectTypeOf<CopilotCorsConfig>().toEqualTypeOf<CopilotKitCorsConfig>();
    expectTypeOf<NodeCopilotListener>().toEqualTypeOf<NodeCopilotKitListener>();
    expectTypeOf<NodeCopilotListenerWithChannels>().toEqualTypeOf<NodeCopilotKitListenerWithChannels>();
  });

  test("createCopilotRuntimeHandler answers like createCopilotKitRuntimeHandler", async () => {
    const options = {
      runtime: new CopilotKitRuntime({ agents: {} }),
      basePath: "/api",
    };
    const oldResponse =
      await createCopilotRuntimeHandler(options)(infoRequest());
    const newResponse =
      await createCopilotKitRuntimeHandler(options)(infoRequest());

    expect(oldResponse.status).toBe(200);
    expect(await oldResponse.json()).toEqual(await newResponse.json());
  });

  test("createCopilotRuntimeHandler keeps the channels overload", async () => {
    const handler: CopilotKitRuntimeFetchHandlerWithChannels =
      createCopilotRuntimeHandler({
        runtime: runtimeWithChannel(),
        __channelEngine: fakeChannelEngine(),
      });

    await handler.channels.ready({ timeoutMs: 1000 });
    expect(handler.channels.status().overall).toBe("online");
    await handler.channels.stop();
  });

  test("createCopilotNodeHandler serves the fetch handler like createCopilotKitNodeHandler", async () => {
    const handler = createCopilotKitRuntimeHandler({
      runtime: new CopilotKitRuntime({ agents: {} }),
      basePath: "/api",
    });

    expect(await getInfo(createCopilotNodeHandler(handler))).toEqual(
      await getInfo(createCopilotKitNodeHandler(handler)),
    );
  });

  test("createCopilotNodeListener serves the runtime like createCopilotKitNodeListener", async () => {
    const options = {
      runtime: new CopilotKitRuntime({ agents: {} }),
      basePath: "/api",
    };

    expect(await getInfo(createCopilotNodeListener(options))).toEqual(
      await getInfo(createCopilotKitNodeListener(options)),
    );
  });

  test("createCopilotNodeListener keeps the channels overload", async () => {
    const listener: NodeCopilotKitListenerWithChannels =
      createCopilotNodeListener({
        runtime: runtimeWithChannel(),
        __channelEngine: fakeChannelEngine(),
      });

    await listener.channels.ready({ timeoutMs: 1000 });
    expect(listener.channels.status().overall).toBe("online");
    await listener.channels.stop();
  });
});
