"use client";

import { useContext, useEffect, useRef } from "react";
import { CopilotContext } from "../context/copilot-context";
import { DocumentPointer } from "../types";

/**
 * Adds the given information to the Copilot context to make it readable by Copilot.
 * @param information - The information to be added to the Copilot context.
 * @param parentId - The ID of the parent context, if any.
 * @param categories - An array of categories to control which context are visible where. Particularly useful with CopilotTextarea (see `useMakeAutosuggestionFunction`)
 * @returns The ID of the added context.
 */
export function useMakeCopilotDocumentReadable(
  document: DocumentPointer,
  categories?: string[],
  dependencies: any[] = []
): string | undefined {
  const { addDocumentContext, removeDocumentContext } =
    useContext(CopilotContext);
  const idRef = useRef<string>();

  useEffect(() => {
    const id = addDocumentContext(document, categories);
    idRef.current = id;

    return () => {
      removeDocumentContext(id);
    };
  }, [addDocumentContext, removeDocumentContext, ...dependencies]);

  return idRef.current;
}
