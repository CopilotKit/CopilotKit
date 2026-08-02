import { createChannel } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import { buildChannelActivationMetadata } from "./runtime.js";

test("declares Tasks only for a Channel with a model and handler", () => {
  const model = {
    kind: "text",
    name: "test",
    model: "test",
    structuredOutput: vi.fn(),
    chatStream: vi.fn(),
    "~types": {},
  } as never;
  const tasks = createChannel({
    identifyUser: "platform",
    name: "task-channel",
    tasks: { model },
  });
  tasks.onTask(vi.fn());
  const ordinary = createChannel({
    identifyUser: "platform",
    name: "ordinary-channel",
  });

  const metadata = buildChannelActivationMetadata([tasks, ordinary], {
    runtimeEnv: "test",
  });

  expect(metadata.declaredChannels).toEqual([
    { channelName: "task-channel", commands: [], tasks: true },
    { channelName: "ordinary-channel", commands: [] },
  ]);
});
