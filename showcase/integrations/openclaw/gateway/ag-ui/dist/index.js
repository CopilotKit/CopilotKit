import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { aguiChannelPlugin } from "./src/channel.js";
import {
  createAguiHttpHandler,
  createOperatorAguiHttpHandler,
} from "./src/http-handler.js";
import {
  getWriter,
  getMessageId,
  pushToolCallId,
  popToolCallId,
  isClientTool,
} from "./src/tool-store.js";
import {
  extractToolResultText,
  tryParseA2UIOperations,
  groupBySurface,
  A2UI_OPERATIONS_KEY,
} from "./src/a2ui.js";
/**
 * Handles the `before_tool_call` OpenClaw hook.
 * Emits TOOL_CALL_START + TOOL_CALL_ARGS (and TOOL_CALL_END for client tools).
 */
export function handleBeforeToolCall(event, ctx) {
  const sk = ctx.sessionKey;
  if (!sk) {
    return;
  }
  const writer = getWriter(sk);
  if (!writer) {
    return;
  }
  // Marked client/frontend + state-writer tools are emitted by the HTTP
  // handler's pendingToolCalls path (client tools) or intercepted into
  // STATE_SNAPSHOTs (state writers). The writer is now registered on EVERY turn
  // so BACKEND (server-side) tools render even when the turn also carries client
  // tools — so skip the marked names here to avoid a duplicate TOOL_CALL_*
  // sequence for the same call.
  if (isClientTool(sk, event.toolName)) {
    return;
  }
  // Server (backend) tool: emit START + ARGS and push the id so
  // tool_result_persist can emit TOOL_CALL_RESULT + TOOL_CALL_END after
  // execute() completes.
  const toolCallId = `tool-${randomUUID()}`;
  writer({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName: event.toolName,
  });
  if (event.params && Object.keys(event.params).length > 0) {
    writer({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify(event.params),
    });
  }
  pushToolCallId(sk, toolCallId);
}
/**
 * Handles the `tool_result_persist` OpenClaw hook.
 * Emits TOOL_CALL_RESULT + TOOL_CALL_END for server-side tools.
 */
export function handleToolResultPersist(event, ctx) {
  const sk = ctx.sessionKey;
  if (!sk) {
    return;
  }
  const writer = getWriter(sk);
  const toolCallId = popToolCallId(sk);
  const messageId = getMessageId(sk);
  if (writer && toolCallId && messageId) {
    // Extract actual tool result text from event.message.content
    const msg = event.message;
    const resultText = msg?.content ? extractToolResultText(msg.content) : "";
    // Use a dedicated messageId for the tool result so it doesn't collide
    // with the text message messageId. Tool events are linked via toolCallId.
    const toolResultMessageId = `msg-tool-${toolCallId}`;
    writer({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: toolResultMessageId,
      content: resultText,
    });
    // Detect A2UI and emit ACTIVITY_SNAPSHOT per surface
    const a2uiOps = tryParseA2UIOperations(resultText);
    if (a2uiOps) {
      const groups = groupBySurface(a2uiOps);
      for (const [surfaceId, ops] of groups) {
        writer({
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `a2ui-surface-${surfaceId}-${toolCallId}`,
          activityType: "a2ui-surface",
          content: { [A2UI_OPERATIONS_KEY]: ops },
          replace: true,
        });
      }
    }
    writer({
      type: EventType.TOOL_CALL_END,
      toolCallId,
    });
  }
}
const plugin = {
  id: "ag-ui",
  name: "AG-UI",
  description: "AG-UI protocol endpoint for CopilotKit and HttpAgent clients",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    api.registerChannel({ plugin: aguiChannelPlugin });
    // Example tools (not published to npm — live in examples/)
    import("./examples/cron-report-tool.js")
      .then(({ cronReportToolFactory }) => {
        api.registerTool(cronReportToolFactory, {
          name: "cron_report",
          optional: true,
        });
      })
      .catch(() => {
        // examples/ not available (npm install) — skip
      });
    // Use registerPluginHttpRoute from plugin-runtime which writes directly to
    // the pinned HTTP route registry. api.registerHttpRoute writes to the
    // loader's private registry which is not the one the HTTP handler reads.
    import("openclaw/plugin-sdk/plugin-runtime")
      .then((mod) => {
        mod.registerPluginHttpRoute({
          path: "/v1/ag-ui",
          auth: "plugin",
          match: "exact",
          pluginId: "ag-ui",
          handler: createAguiHttpHandler(api),
        });
        // Operator-auth AG-UI route — for OpenClaw operator-UI embedded
        // consumers (plugin-contributed `chat.surface` slot, etc.) that
        // already hold a gateway token and shouldn't need a second pairing
        // dance. Gateway validates operator scope before our handler runs.
        mod.registerPluginHttpRoute({
          path: "/v1/ag-ui/operator",
          auth: "gateway",
          match: "exact",
          pluginId: "ag-ui",
          handler: createOperatorAguiHttpHandler(api),
        });
      })
      .catch((err) => {
        console.error("[ag-ui] failed to register HTTP routes:", err);
      });
    api.on("before_tool_call", handleBeforeToolCall);
    api.on("tool_result_persist", handleToolResultPersist);
    // CLI commands for device management
    api.registerCli(
      ({ program }) => {
        const agui = program
          .command("ag-ui")
          .description("AG-UI (AG-UI) channel commands");
        agui
          .command("devices")
          .description("List approved devices")
          .action(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types lag behind runtime
            const devices =
              await api.runtime.channel.pairing.readAllowFromStore({
                channel: "ag-ui",
              });
            if (devices.length === 0) {
              console.log("No approved devices.");
              return;
            }
            console.log("Approved devices:");
            for (const deviceId of devices) {
              console.log(`  ${deviceId}`);
            }
          });
      },
      { commands: ["ag-ui"] },
    );
  },
};
export default plugin;
