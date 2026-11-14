<script lang="ts">
  import type { CopilotKitCoreSubscriber } from "@copilotkit/core";
  import { useCopilotKit } from "../../providers/useCopilotKit";
  const context = useCopilotKit();

  function emitOverlappingToolCalls() {
    const subscribers = (
      context.copilotkit as unknown as {
        subscribers: Set<CopilotKitCoreSubscriber>;
      }
    ).subscribers;
    const baseEvent = {
      copilotkit: context.copilotkit,
      agentId: "test-agent",
      toolName: "test-tool",
    };

    for (const subscriber of subscribers) {
      subscriber.onToolExecutionStart?.({
        ...baseEvent,
        toolCallId: "call-a",
        args: {},
      });
      subscriber.onToolExecutionEnd?.({
        ...baseEvent,
        toolCallId: "call-a",
        result: "done",
      });
      subscriber.onToolExecutionStart?.({
        ...baseEvent,
        toolCallId: "call-b",
        args: {},
      });
    }
  }

  function checkAutoRenderer() {
    const renderer = context.copilotkit.renderToolCalls.find(
      (entry) => entry.name === "scoped-no-args",
    );
    autoRendererRegistered =
      renderer?.agentId === "agent-scoped" && !!renderer.args;
  }
  let autoRendererRegistered = $state(false);
</script>

<button data-testid="overlap-tool-calls" onclick={emitOverlappingToolCalls}>overlap</button>
<output data-testid="runtime-url">{context.runtimeUrl ?? ""}</output>
<output data-testid="headers">{JSON.stringify(context.headers)}</output>
<output data-testid="executing-tool-calls">
  {JSON.stringify([...context.executingToolCallIds])}
</output>
<button data-testid="check-auto-renderer" onclick={checkAutoRenderer}>check renderer</button>
<output data-testid="auto-renderer-registered">{autoRendererRegistered}</output>
