/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — RenderSuggestion:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-ui/src/components/chat/Suggestion.tsx
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { useCopilotChatInternal } from "@copilotkit/react-core";
import { SmallSpinnerIcon } from "./Icons";

interface SuggestionsProps {
  title: string;
  message: string;
  partial?: boolean;
  className?: string;
  onClick: () => void;
}

export function Suggestion({
  title,
  onClick,
  partial,
  className,
}: SuggestionsProps) {
  const { isLoading } = useCopilotChatInternal();
  if (!title) return null;

  return (
    <button
      disabled={partial || isLoading}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`suggestion ${className ?? ""} ${partial ? "loading" : ""}`}
      data-test-id="suggestion"
      type="button"
    >
      {partial ? SmallSpinnerIcon : <span>{title}</span>}
    </button>
  );
}
