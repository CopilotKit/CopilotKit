import { useContext, useEffect, useRef } from "react";
import { CopilotContext } from "../context/copilot-context";

/**
 * @deprecated Use the useCopilotReadable function instead.
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
