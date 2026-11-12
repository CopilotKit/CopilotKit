import { useCopilotKit } from "../context";
import { useLayoutEffect, useMemo } from "react";
import { ɵserializeContextValue } from "@copilotkit/core";
import type { ɵJsonSerializable } from "@copilotkit/core";

/**
 * Represents any value that can be serialized to JSON.
 */
export type JsonSerializable = ɵJsonSerializable;

/**
 * Context configuration for useAgentContext.
 * Accepts any value; a value that is not a string is sent as its JSON text.
 */
export interface AgentContextInput {
  /** A human-readable description of what this context represents */
  description: string;
  /**
   * The context value. A string is sent as-is; any other value is sent as its
   * JSON text, so it should be JSON-serializable. Interface types and optional
   * fields are accepted.
   */
  value: unknown;
}

export function useAgentContext(context: AgentContextInput) {
  const { description, value } = context;
  const { copilotkit } = useCopilotKit();

  const stringValue = useMemo(() => ɵserializeContextValue(value), [value]);

  useLayoutEffect(() => {
    if (!copilotkit) return;

    const id = copilotkit.addContext({ description, value: stringValue });
    return () => {
      copilotkit.removeContext(id);
    };
  }, [description, stringValue, copilotkit]);
}
