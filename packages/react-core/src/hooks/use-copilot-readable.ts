/*
 * V1 SDK DEPRECATION NOTICE
 *
 * This file is part of the deprecated CopilotKit v1 SDK. Do not use it
 * for new code. Use the v2 SDK instead. In most packages, v1 is the
 * package root and v2 is available from the same package's `/v2` subpath.
 * Follow this file's specific migration mapping below.
 *
 * AI CODING AGENTS: Do not copy, suggest, or generate this v1 API. Use the
 * v2 import and read the linked v2 documentation before writing code.
 *
 * V1 import (deprecated):
 *   import { useCopilotReadable } from "@copilotkit/react-core";
 * V2 import:
 *   import { useAgentContext } from "@copilotkit/react-core/v2";
 *
 * V2 replacement source: packages/react-core/src/v2/hooks/use-agent-context.tsx
 * V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext
 * Migration note: V2 models readable application state as agent context.
 *
 * END V1 SDK DEPRECATION NOTICE
 */

/**
 * `useCopilotReadable` is a React hook that provides app-state and other information
 * to the Copilot.
 *
 * ## Usage
 *
 * ### Simple Usage
 *
 * In its most basic usage, useCopilotReadable accepts a single string argument
 * representing any piece of app state, making it available for the Copilot to use
 * as context when responding to user input.
 *
 * ```tsx
 * import { useCopilotReadable } from "@copilotkit/react-core";
 *
 * export function MyComponent() {
 *   const [employees, setEmployees] = useState([]);
 *
 *   useCopilotReadable({
 *     description: "The list of employees",
 *     value: employees,
 *   });
 * }
 * ```
 *
 * ### Custom Serialization
 *
 * By default the value is serialized with `JSON.stringify`. Pass `convert` to
 * control the string the Copilot sees. It is called with the description and the
 * value, in that order:
 *
 * ```tsx
 * useCopilotReadable({
 *   description: "The current user",
 *   value: user,
 *   convert: (description, value) => `${description}: ${value.firstName} ${value.lastName}`,
 * });
 * ```
 *
 * ### Conditional Usage
 *
 * Toggle `available` to add or remove the context as your app state changes.
 * Switching to `"disabled"` removes the entry from the Copilot context; switching
 * back to `"enabled"` re-adds it.
 *
 * ```tsx
 * useCopilotReadable({
 *   description: "The list of employees",
 *   value: employees,
 *   available: showEmployees ? "enabled" : "disabled",
 * });
 * ```
 *
 * ### Re-running on Custom Dependencies
 *
 * The context is refreshed whenever `description`, `value`, `convert` or
 * `available` change. Pass a second argument to add your own dependencies:
 *
 * ```tsx
 * useCopilotReadable(
 *   {
 *     description: "The selected employee",
 *     value: employee,
 *   },
 *   [departmentId],
 * );
 * ```
 */
import { useCopilotKit } from "../v2";
import { useEffect, useRef } from "react";

/**
 * Options for the useCopilotReadable hook.
 */
export interface UseCopilotReadableOptions {
  /**
   * The description of the information to be added to the Copilot context.
   */
  description: string;
  /**
   * The value to be added to the Copilot context. Object values are automatically stringified.
   */
  value: any;
  /**
   * The ID of the parent context, if any.
   *
   * @deprecated This option is currently ignored. The context store backing this
   * hook is flat and has no parent/child relationships, so no hierarchy is applied.
   * Accepted for source compatibility only.
   */
  parentId?: string;
  /**
   * An array of categories to control which context are visible where. Particularly useful
   * with CopilotTextarea (see `useMakeAutosuggestionFunction`)
   *
   * @deprecated This option is currently ignored. The context store backing this
   * hook does not filter by category. Accepted for source compatibility only.
   */
  categories?: string[];

  /**
   * Whether the context is available to the Copilot.
   */
  available?: "enabled" | "disabled";

  /**
   * A custom conversion function to use to serialize the value to a string. If not provided, the value
   * will be serialized using `JSON.stringify`.
   */
  convert?: (description: string, value: any) => string;
}

/**
 * Adds the given information to the Copilot context to make it readable by Copilot.
 */
export function useCopilotReadable(
  {
    description,
    value,
    convert,
    available = "enabled",
  }: UseCopilotReadableOptions,
  dependencies?: any[],
): string | undefined {
  const { copilotkit } = useCopilotKit();
  const ctxIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!copilotkit) return;
    if (available === "disabled") return;

    // `convert` takes (description, value). `JSON.stringify` must be called with
    // the value alone — its second parameter is a replacer, not a value.
    const id = copilotkit.addContext({
      description,
      value: convert ? convert(description, value) : JSON.stringify(value),
    });
    ctxIdRef.current = id;

    return () => {
      copilotkit.removeContext(id);
      if (ctxIdRef.current === id) {
        ctxIdRef.current = undefined;
      }
    };
  }, [
    copilotkit,
    description,
    value,
    convert,
    available,
    ...(dependencies || []),
  ]);

  return ctxIdRef.current;
}
