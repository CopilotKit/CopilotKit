import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
// Import through the public source barrels, so the test covers the names that
// consumers import from `@copilotkit/runtime` and `@copilotkit/runtime/node`.
import {
  createCopilotKitRuntimeHandler,
  createCopilotRuntimeHandler,
} from "../../index";
import type { CopilotRuntimeFetchHandlerWithChannels } from "../../index";
import {
  createCopilotKitNodeHandler,
  createCopilotKitNodeListener,
  createCopilotNodeHandler,
  createCopilotNodeListener,
} from "../../node";
import type { NodeCopilotListenerWithChannels } from "../../node";
import { CopilotRuntime } from "../core/runtime";
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
  new CopilotRuntime({
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

describe("deprecated handler names", () => {
  test("createCopilotRuntimeHandler answers like createCopilotKitRuntimeHandler", async () => {
    const options = {
      runtime: new CopilotRuntime({ agents: {} }),
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
    const handler: CopilotRuntimeFetchHandlerWithChannels =
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
      runtime: new CopilotRuntime({ agents: {} }),
      basePath: "/api",
    });

    expect(await getInfo(createCopilotNodeHandler(handler))).toEqual(
      await getInfo(createCopilotKitNodeHandler(handler)),
    );
  });

  test("createCopilotNodeListener serves the runtime like createCopilotKitNodeListener", async () => {
    const options = {
      runtime: new CopilotRuntime({ agents: {} }),
      basePath: "/api",
    };

    expect(await getInfo(createCopilotNodeListener(options))).toEqual(
      await getInfo(createCopilotKitNodeListener(options)),
    );
  });

  test("createCopilotNodeListener keeps the channels overload", async () => {
    const listener: NodeCopilotListenerWithChannels = createCopilotNodeListener(
      {
        runtime: runtimeWithChannel(),
        __channelEngine: fakeChannelEngine(),
      },
    );

    await listener.channels.ready({ timeoutMs: 1000 });
    expect(listener.channels.status().overall).toBe("online");
    await listener.channels.stop();
  });
});
