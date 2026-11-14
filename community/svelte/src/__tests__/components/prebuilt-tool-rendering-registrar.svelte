<script lang="ts">
  import type { Message } from "@ag-ui/core";
  import { createRawSnippet } from "svelte";
  import type { SvelteSet } from "svelte/reactivity";
  import { z } from "zod";
  import CopilotChatMessageView from "../../components/chat/CopilotChatMessageView.svelte";
  import { registerHumanInTheLoop } from "../../hooks/register-human-in-the-loop.svelte";
  import { registerRenderToolCall } from "../../hooks/register-render-tool-call.svelte";
  import { useCopilotKit } from "../../providers/useCopilotKit";

  const messages: Message[] = [
    {
      id: "assistant-1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "weather-1",
          type: "function",
          function: {
            name: "lookupWeather",
            arguments: '{"city":"London"}',
          },
        },
        {
          id: "ping-1",
          type: "function",
          function: {
            name: "ping",
            arguments: "{}",
          },
        },
        {
          id: "call-a",
          type: "function",
          function: {
            name: "approve-action",
            arguments: '{"topic":"alpha"}',
          },
        },
        {
          id: "call-b",
          type: "function",
          function: {
            name: "approve-action",
            arguments: '{"topic":"beta"}',
          },
        },
      ],
    },
    {
      id: "tool-weather",
      role: "tool",
      content: "Sunny",
      toolCallId: "weather-1",
    },
  ];

  registerRenderToolCall({
    name: "lookupWeather",
    agentId: "other-agent",
    render: () => "scoped-other",
  });

  registerRenderToolCall({
    name: "lookupWeather",
    parameters: z.object({ city: z.string().optional() }),
    render: (props) => {
      const city =
        props.parameters &&
        typeof props.parameters === "object" &&
        "city" in props.parameters
          ? String(props.parameters.city)
          : "";
      return `weather:${props.toolCallId}:${props.status}:${city}:${props.result ?? ""}`;
    },
  });

  registerHumanInTheLoop({
    name: "approve-action",
    description: "Approve the action",
    parameters: z.object({ topic: z.string() }),
    render: (props) => {
      const topic = props.args.topic ?? "";
      return createRawSnippet(() => ({
        render: () =>
          `<div data-testid="hitl-${props.toolCallId}"><span data-testid="hitl-status-${props.toolCallId}">${props.status}</span><span data-testid="hitl-topic-${props.toolCallId}">${topic}</span>${
            props.respond
              ? `<button type="button" data-testid="respond-${props.toolCallId}">Approve</button>`
              : ""
          }</div>`,
        setup: (element) => {
          const respond = props.respond;
          if (!respond) return;
          const button = element.querySelector("button");
          if (!button) return;
          const onClick = () => {
            void respond(`yes:${props.toolCallId}`);
          };
          button.addEventListener("click", onClick);
          return () => button.removeEventListener("click", onClick);
        },
      }));
    },
  });

  const { copilotkit, executingToolCallIds } = useCopilotKit();
  let firstResult = $state("");
  let secondResult = $state("");

  function startHitl() {
    const tool = copilotkit.getTool({ toolName: "approve-action" });
    if (!tool?.handler) {
      throw new Error("approve-action was not registered");
    }
    const executing = executingToolCallIds as SvelteSet<string>;
    const first = tool.handler(
      { topic: "alpha" },
      {
        toolCall: {
          id: "call-a",
          type: "function",
          function: {
            name: "approve-action",
            arguments: '{"topic":"alpha"}',
          },
        },
      },
    );
    const second = tool.handler(
      { topic: "beta" },
      {
        toolCall: {
          id: "call-b",
          type: "function",
          function: {
            name: "approve-action",
            arguments: '{"topic":"beta"}',
          },
        },
      },
    );
    executing.add("call-a");
    executing.add("call-b");
    void Promise.resolve(first).then((value) => {
      firstResult = String(value);
    });
    void Promise.resolve(second).then((value) => {
      secondResult = String(value);
    });
  }
</script>

<CopilotChatMessageView {messages} isRunning={false} />
<button data-testid="start-hitl" onclick={startHitl}>start</button>
<output data-testid="hitl-first">{firstResult}</output>
<output data-testid="hitl-second">{secondResult}</output>
