import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
// Import through the `/v2` source entries, so the test covers the names that
// 1.x code imports from `@copilotkit/runtime/v2` and
// `@copilotkit/runtime/v2/node`. type-fixtures/v2 checks the built entries.
import * as v2 from "../index";
import * as v2Node from "../node";
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
} from "../index";
import type {
  NodeCopilotKitListener,
  NodeCopilotKitListenerWithChannels,
  NodeCopilotListener,
  NodeCopilotListenerWithChannels,
} from "../node";
import * as root from "../../index";
import * as rootNode from "../../node";
import * as agent from "../../agent";
import { CopilotKitIntelligence } from "../../runtime/intelligence-platform";
import type {
  ActivateChannelEngine,
  ChannelsHandle,
} from "../../runtime/core/channel-manager";

const fakeChannelEngine =
  (): ActivateChannelEngine => async (): Promise<ChannelsHandle> => ({
    metadata: {},
    stop: async () => {},
  });

const runtimeWithChannel = () =>
  new root.CopilotKitRuntime({
    agents: {},
    intelligence: new CopilotKitIntelligence({
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
      apiKey: "cpk-42_short_long",
    }),
    identifyUser: vi.fn().mockResolvedValue({ id: "u", name: "U" }),
    channels: [createChannel({ identifyUser: "platform", name: "support" })],
  });

describe("@copilotkit/runtime/v2", () => {
  test("exports every export of the root, with the same value, except CopilotRuntime", () => {
    // The root's CopilotRuntime is the 1.x class, which 2.0 removed, so it
    // throws. 1.x code that imports CopilotRuntime from /v2 already uses the
    // 2.0 API, so /v2 keeps it working (see the next tests).
    const differing = Object.keys(root).filter(
      (name) => Reflect.get(v2, name) !== Reflect.get(root, name),
    );

    expect(differing).toEqual(["CopilotRuntime"]);
  });

  test("exports the Built-in Agent values of 1.x from @copilotkit/runtime/agent", () => {
    expect(v2.BuiltInAgent).toBe(agent.BuiltInAgent);
    expect(v2.InterruptSignal).toBe(agent.InterruptSignal);
    expect(v2.defineTool).toBe(agent.defineTool);
    expect(v2.convertAISDKStream).toBe(agent.convertAISDKStream);
    expect(v2.convertInputToTanStackAI).toBe(agent.convertInputToTanStackAI);
    expect(v2.convertTanStackStream).toBe(agent.convertTanStackStream);
  });

  test("the old class and function names are the CopilotKit values", () => {
    expect(v2.CopilotRuntime).toBe(root.CopilotKitRuntime);
    expect(v2.CopilotSseRuntime).toBe(root.CopilotKitSseRuntime);
    expect(v2.CopilotIntelligenceRuntime).toBe(
      root.CopilotKitIntelligenceRuntime,
    );
    expect(v2.createCopilotRuntimeHandler).toBe(
      root.createCopilotKitRuntimeHandler,
    );
  });

  test("a runtime built with an old name is an instance of the new name", () => {
    const runtime = new v2.CopilotRuntime({ agents: {} });
    expect(runtime).toBeInstanceOf(root.CopilotKitRuntime);
    expectTypeOf(runtime).toEqualTypeOf<root.CopilotKitRuntime>();

    const sse = new v2.CopilotSseRuntime({ agents: {} });
    expect(sse).toBeInstanceOf(root.CopilotKitSseRuntime);
  });

  test("the old type names are the CopilotKit types", () => {
    expectTypeOf<v2.CopilotRuntime>().toEqualTypeOf<root.CopilotKitRuntime>();
    expectTypeOf<v2.CopilotSseRuntime>().toEqualTypeOf<root.CopilotKitSseRuntime>();
    expectTypeOf<v2.CopilotIntelligenceRuntime>().toEqualTypeOf<root.CopilotKitIntelligenceRuntime>();
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
  });

  test("createCopilotRuntimeHandler keeps the channels overload", async () => {
    const handler: CopilotKitRuntimeFetchHandlerWithChannels =
      v2.createCopilotRuntimeHandler({
        runtime: runtimeWithChannel(),
        __channelEngine: fakeChannelEngine(),
      });

    await handler.channels.ready({ timeoutMs: 1000 });
    expect(handler.channels.status().overall).toBe("online");
    await handler.channels.stop();
  });
});

describe("@copilotkit/runtime/v2/node", () => {
  test("exports every export of @copilotkit/runtime/node, with the same value", () => {
    for (const [name, value] of Object.entries(rootNode)) {
      expect(Reflect.get(v2Node, name), name).toBe(value);
    }
  });

  test("the old function names are the CopilotKit functions", () => {
    expect(v2Node.createCopilotNodeListener).toBe(
      rootNode.createCopilotKitNodeListener,
    );
    expect(v2Node.createCopilotNodeHandler).toBe(
      rootNode.createCopilotKitNodeHandler,
    );
    // 1.x deprecated createNodeFetchHandler as a name of
    // createCopilotNodeHandler.
    expect(v2Node.createNodeFetchHandler).toBe(
      rootNode.createCopilotKitNodeHandler,
    );
  });

  test("the old type names are the CopilotKit types", () => {
    expectTypeOf<NodeCopilotListener>().toEqualTypeOf<NodeCopilotKitListener>();
    expectTypeOf<NodeCopilotListenerWithChannels>().toEqualTypeOf<NodeCopilotKitListenerWithChannels>();
  });

  test("createCopilotNodeListener keeps the channels overload", async () => {
    const listener: NodeCopilotKitListenerWithChannels =
      v2Node.createCopilotNodeListener({
        runtime: runtimeWithChannel(),
        __channelEngine: fakeChannelEngine(),
      });

    await listener.channels.ready({ timeoutMs: 1000 });
    expect(listener.channels.status().overall).toBe("online");
    await listener.channels.stop();
  });
});
