/**
 * A hook for providing app-state & other information to the Copilot.
 *
 * <img referrerPolicy="no-referrer-when-downgrade" src="https://static.scarf.sh/a.png?x-pxid=a9b290bb-38f9-4518-ac3b-8f54fdbf43be" />
 *
 * `useCopilotReadable` is a React hook that provides app-state and other information
 * to the Copilot. Optionally, the hook can also handle hierarchical state within your
 * application, passing these parent-child relationships to the Copilot.
 *
 * <RequestExample>
 *   ```jsx useCopilotReadable Example
 *   import { useCopilotReadable }
 *     from "@copilotkit/react-core";
 *
 *   const myAppState = ...;
 *   useCopilotReadable({
 *     description: "The current state of the app",
 *     value: myAppState
 *   });
 *   ```
 * </RequestExample>
 *
 * In its most basic usage, useCopilotReadable accepts a single string argument
 * representing any piece of app state, making it available for the Copilot to use
 * as context when responding to user input.
 *
 * For example:
 *
 * ```jsx simple state example
 * import { useCopilotReadable }  from "@copilotkit/react-core";
 *
 * const userName = "Rust Cohle";
 * useCopilotReadable({
 *   description: "The name of the user",
 *   value: userName
 * });
 * ```
 *
 * You can also pass in an object representing your app state,
 * for example:
 *
 * ```jsx using state
 * import { useCopilotReadable }  from "@copilotkit/react-core";
 *
 * const myAppState = {
 *   userName: "Rust Cohle",
 *   userAddress: {
 *     street: "4500 Old Spanish Trail",
 *     city: "New Orleans",
 *     state: "LA",
 *     zip: "70129"
 *   }
 * };
 * useCopilotReadable({
 *   description: "The current state of the app",
 *   value: myAppState
 * });
 * ```
 *
 * Optionally, you can maintain the hierarchical structure of information by passing
 * `parentId`:
 *
 * ```jsx parentId example
 * import { useCopilotReadable } from "@copilotkit/react-core";
 *
 *
 * function Employee(props: EmployeeProps) {
 *   const { employeeName, workProfile, metadata } = props;
 *
 *   // propagate any information copilot
 *   const employeeContextId = useCopilotReadable({
 *     description: "Employee name",
 *     value: employeeName
 *   });
 *
 *   // Pass a parentID to maintain a hierarchical structure.
 *   // Especially useful with child React components, list elements, etc.
 *   useCopilotReadable({
 *     description: "Work profile",
 *     value: workProfile.description(),
 *     parentId: employeeContextId
 *   });
 *   useCopilotReadable({
 *     description: "Employee metadata",
 *     value: metadata.description(),
 *     parentId: employeeContextId
 *   });
 *
 *   return (
 *     // Render as usual...
 *   );
 * }
 * ```
 */
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
