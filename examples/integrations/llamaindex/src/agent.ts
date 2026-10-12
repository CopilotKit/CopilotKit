import { LlamaIndexAgent } from "@ag-ui/llamaindex";
import type { RunAgentInput } from "@ag-ui/client";

const PAGE_CONTEXT_MESSAGE_ID = "copilotkit-page-context";

/**
 * Sends what the page shares (`useAgentContext`) to the model as a system
 * message.
 *
 * The Python workflow (`llama-index-protocols-ag-ui`) reads the run's messages
 * and state but never its AG-UI `context`, so without this the model never
 * sees it. The workflow merges its `system_prompt` into this message and echoes
 * it back in its messages snapshot, so the echoed copy (same id) is dropped
 * each turn and replaced with the current context.
 */
class StarterLlamaIndexAgent extends LlamaIndexAgent {
  override run(input: RunAgentInput) {
    const messages = input.messages.filter(
      (message) => message.id !== PAGE_CONTEXT_MESSAGE_ID,
    );
    if (input.context.length > 0) {
      const shared = input.context
        .map(({ description, value }) => `${description}:\n${value}`)
        .join("\n\n");
      messages.unshift({
        id: PAGE_CONTEXT_MESSAGE_ID,
        role: "system",
        content: `Context provided by the application:\n\n${shared}`,
      });
    }
    return super.run({ ...input, messages });
  }
}

/** Builds this starter's agent. See channel-host.mts for why this is shared. */
export function createDefaultAgent(): LlamaIndexAgent {
  return new StarterLlamaIndexAgent({
    url:
      (process.env.AGENT_URL || "http://127.0.0.1:9000").replace(/\/$/, "") +
      "/run",
  });
}
