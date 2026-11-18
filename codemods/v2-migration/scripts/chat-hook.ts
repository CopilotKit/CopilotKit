import {
  argumentNodes,
  destructuredMembers,
  destructuringDeclaration,
  indentOf,
  uniqueNamer,
} from "./ast-helpers.ts";
import type { Node } from "./ast-helpers.ts";
import { migrateV1Calls } from "./v1-calls.ts";

/** The members of the v1 `useCopilotChat` result this rewrite keeps. */
const MEMBERS = new Set([
  "visibleMessages",
  "isLoading",
  "appendMessage",
  "setMessages",
  "stopGeneration",
  "runChatCompletion",
]);
/** Members that need the CopilotKit core. */
const NEEDS_CORE = new Set([
  "appendMessage",
  "stopGeneration",
  "runChatCompletion",
]);

/**
 * Rewrites `const { visibleMessages, appendMessage, ... } = useCopilotChat()`
 * to `useAgent()` (the default agent, as v1 used) and keeps each value:
 *
 * - `visibleMessages` is `agent.messages`, `isLoading` is `agent.isRunning`;
 * - `appendMessage(message, { followUp })` adds the message and runs the
 *   agent, unless `followUp` is false;
 * - `setMessages` sets the agent's messages;
 * - `stopGeneration` stops the agent, `runChatCompletion` runs it.
 *
 * v1 messages built with `new TextMessage(...)` become plain AG-UI messages
 * in the gql-messages pass. A call with options, a result that is not
 * destructured, or any other member (`reloadMessages`, `reset`,
 * `isAvailable`, `mcpServers`, ...) keeps the TODO.
 */
export function migrateChatHooks(rootNode: Node): string | null {
  const unique = uniqueNamer(rootNode);
  return migrateV1Calls(rootNode, "useCopilotChat", (call, { source }) => {
    const args = argumentNodes(call);
    if (args.length > 1) return null;
    if (args.length === 1 && args[0]!.text().replace(/\s/g, "") !== "{}") {
      return null;
    }
    const found = destructuringDeclaration(call);
    if (!found) return null;
    const members = destructuredMembers(found.pattern);
    if (!members || members.size === 0) return null;
    if ([...members.keys()].some((member) => !MEMBERS.has(member))) return null;

    const agent = unique("agent");
    // `{ agent }` when the variable is named `agent`.
    const agentProp = agent === "agent" ? "agent" : `agent: ${agent}`;
    const keyword = found.declaration.text().startsWith("let")
      ? "let"
      : "const";
    const lines = [
      `${keyword} ${agent === "agent" ? "{ agent }" : `{ agent: ${agent} }`} = useAgent();`,
    ];
    const hooks = ["useAgent"];
    let copilotkit: string | undefined;
    if ([...members.keys()].some((member) => NEEDS_CORE.has(member))) {
      copilotkit = unique("copilotkit");
      lines.push(
        copilotkit === "copilotkit"
          ? "const { copilotkit } = useCopilotKit();"
          : `const { copilotkit: ${copilotkit} } = useCopilotKit();`,
      );
      hooks.push("useCopilotKit");
    }
    for (const [member, local] of members) {
      switch (member) {
        case "visibleMessages":
          lines.push(`const ${local} = ${agent}.messages;`);
          break;
        case "isLoading":
          lines.push(`const ${local} = ${agent}.isRunning;`);
          break;
        case "setMessages":
          lines.push(
            `const ${local} = (messages: Parameters<typeof ${agent}.setMessages>[0]) => ${agent}.setMessages(messages);`,
          );
          break;
        case "appendMessage":
          lines.push(
            `const ${local} = async (message: Parameters<typeof ${agent}.addMessage>[0], options?: { followUp?: boolean }) => {`,
            `  ${agent}.addMessage(message);`,
            `  if (options?.followUp ?? true) await ${copilotkit}.runAgent({ ${agentProp} });`,
            `};`,
          );
          break;
        case "stopGeneration":
          lines.push(
            `const ${local} = () => ${copilotkit}.stopAgent({ ${agentProp} });`,
          );
          break;
        case "runChatCompletion":
          lines.push(
            `const ${local} = () => ${copilotkit}.runAgent({ ${agentProp} });`,
          );
          break;
      }
    }
    const indent = indentOf(found.declaration, source);
    return {
      edits: [found.declaration.replace(lines.join(`\n${indent}`))],
      hooks,
    };
  });
}
