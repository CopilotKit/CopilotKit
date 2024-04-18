import { useContext, useEffect, useRef } from "react";
import { CopilotContext } from "../context/copilot-context";

/**
 * Adds the given information to the Copilot context to make it readable by Copilot.
 * @param information - The information to be added to the Copilot context.
 * @param parentId - The ID of the parent context, if any.
 * @param categories - An array of categories to control which context are visible where. Particularly useful with CopilotTextarea (see `useMakeAutosuggestionFunction`)
 * @returns The ID of the added context.
 */
export function useMakeCopilotReadable(
  information: string,
  parentId?: string,
  categories?: string[],
): string | undefined {
  const { addContext, removeContext } = useContext(CopilotContext);
  const idRef = useRef<string>();

  useEffect(() => {
    const id = addContext(information, parentId, categories);
    idRef.current = id;

    return () => {
      removeContext(id);
    };
  }, [information, parentId, addContext, removeContext]);

  return idRef.current;
}
