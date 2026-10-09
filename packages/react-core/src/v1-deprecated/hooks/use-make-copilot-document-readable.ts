/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useMakeCopilotDocumentReadable:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Agent context): https://docs.copilotkit.ai/agent-app-context
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { useEffect, useRef } from "react";
import { useCopilotContext } from "../context/copilot-context";
import type { DocumentPointer } from "../types";

/**
 * Makes a document readable by Copilot.
 * @param document The document to make readable.
 * @param categories The categories to associate with the document.
 * @param dependencies The dependencies to use for the effect.
 * @returns The id of the document.
 */
export function useMakeCopilotDocumentReadable(
  document: DocumentPointer,
  categories?: string[],
  dependencies: any[] = [],
): string | undefined {
  const { addDocumentContext, removeDocumentContext } = useCopilotContext();
  const idRef = useRef<string>(undefined!);

  useEffect(() => {
    const id = addDocumentContext(document, categories);
    idRef.current = id;

    return () => {
      removeDocumentContext(id);
    };
  }, [addDocumentContext, removeDocumentContext, ...dependencies]);

  return idRef.current;
}
