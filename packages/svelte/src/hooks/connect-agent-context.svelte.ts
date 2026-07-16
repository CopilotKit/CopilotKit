import { getContext } from "svelte";
import { COPILOT_KIT_KEY } from "../providers/context";
import type { CopilotKitContextValue } from "../providers/context";

export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

export interface AgentContextInput {
  description: string;
  value: JsonSerializable;
}

export function connectAgentContext(context: AgentContextInput): void {
  const ctx = getContext<CopilotKitContextValue | null>(COPILOT_KIT_KEY);
  if (!ctx) {
    throw new Error(
      "connectAgentContext must be used within CopilotKitProvider",
    );
  }

  let contextId: string | undefined;

  $effect(() => {
    const core = ctx.copilotkit;
    const description = context.description;
    const raw = context.value;
    const stringValue =
      raw === undefined
        ? ""
        : typeof raw === "string"
          ? raw
          : JSON.stringify(raw);

    const id = core.addContext({
      description,
      value: stringValue,
    });
    contextId = id;

    return () => {
      core.removeContext(id);
    };
  });
}
