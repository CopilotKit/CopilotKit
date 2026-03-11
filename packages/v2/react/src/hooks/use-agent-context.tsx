import { useCopilotKit } from "../providers/CopilotKitProvider";
import { useEffect, useMemo } from "react";

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

export function useAgentContext(context: AgentContextInput) {
  const { description, value } = context;
  const { copilotkit } = useCopilotKit();

  const stringValue = useMemo(() => {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  }, [value]);

  useEffect(() => {
    if (!copilotkit) return;

    const id = copilotkit.addContext({ description, value: stringValue });
    return () => {
      copilotkit.removeContext(id);
    };
  }, [description, stringValue, copilotkit]);
}
