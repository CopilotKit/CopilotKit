import { useContext, useEffect, useRef } from "react";
import { CopilotContext } from "../context/copilot-context";

/**
 * Options for the useCopilotReadable hook.
 */
export interface UseCopilotReadableOptions {
  /**
   * The description of the information to be added to the Copilot context.
   */
  description: string;
  /**
   * The value to be added to the Copilot context.
   */
  value: any;
  /**
   * The ID of the parent context, if any.
   */
  parentId?: string;
  /**
   * An array of categories to control which context are visible where. Particularly useful
   * with CopilotTextarea (see `useMakeAutosuggestionFunction`)
   */
  categories?: string[];

  /**
   * A custom conversion function to use to serialize the value to a string. If not provided, the value
   * will be serialized using `JSON.stringify`.
   */
  convert?: (description: string, value: any) => string;
}

function convertToJSON(description: string, value: any): string {
  return `${description}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
}

/**
 * Adds the given information to the Copilot context to make it readable by Copilot.
 */
export function useCopilotReadable(
  { description, value, parentId, categories, convert }: UseCopilotReadableOptions,
  dependencies?: any[],
): string | undefined {
  const { addContext, removeContext } = useContext(CopilotContext);
  const idRef = useRef<string>();
  convert = convert || convertToJSON;

  const information = convert(description, value);

  useEffect(() => {
    const id = addContext(information, parentId, categories);
    idRef.current = id;

    return () => {
      removeContext(id);
    };
  }, [information, parentId, addContext, removeContext, ...(dependencies || [])]);

  return idRef.current;
}
