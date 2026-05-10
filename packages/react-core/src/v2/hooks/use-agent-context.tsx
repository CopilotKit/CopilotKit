import { useCopilotKit } from "../context";
import { useLayoutEffect, useMemo } from "react";

/**
 * Represents any value that can be serialized to JSON.
 */
export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

/**
 * Context configuration for useAgentContext.
 * Accepts any JSON-serializable value which will be converted to a string.
 */
export interface AgentContextInput {
  /** A human-readable description of what this context represents */
  description: string;
  /** The context value - will be converted to a JSON string if not already a string */
  value: JsonSerializable;
}

interface SerializedAgentContextInput {
  description: string;
  value: string;
}

function stringify(value: JsonSerializable): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function serializeContexts(
  contextOrContexts: AgentContextInput | AgentContextInput[],
): SerializedAgentContextInput[] {
  const contexts = Array.isArray(contextOrContexts)
    ? contextOrContexts
    : [contextOrContexts];

  return contexts.map(({ description, value }) => ({
    description,
    value: stringify(value),
  }));
}

export function useAgentContext(context: AgentContextInput): void;
export function useAgentContext(contexts: AgentContextInput[]): void;
export function useAgentContext(
  contextOrContexts: AgentContextInput | AgentContextInput[],
) {
  const { copilotkit } = useCopilotKit();
  const serializedContextsKey = JSON.stringify(
    serializeContexts(contextOrContexts),
  );
  const serializedContexts = useMemo(
    () => JSON.parse(serializedContextsKey) as SerializedAgentContextInput[],
    [serializedContextsKey],
  );

  useLayoutEffect(() => {
    if (!copilotkit) return;

    const ids = serializedContexts.map((context) =>
      copilotkit.addContext(context),
    );

    return () => {
      ids.forEach((id) => copilotkit.removeContext(id));
    };
  }, [serializedContexts, copilotkit]);
}
