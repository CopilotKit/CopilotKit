/** A root-entry consumer that owns its model call and installs no model SDK. */
import { EventType } from "@ag-ui/client";
import { BuiltInAgent, CopilotRuntime } from "@copilotkit/runtime";

const agent = new BuiltInAgent({
  type: "custom",
  async *factory({ input }) {
    yield {
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: `${input.runId}-reply`,
      role: "assistant",
      delta: "hello",
    };
  },
});

export const runtime = new CopilotRuntime({ agents: { default: agent } });
