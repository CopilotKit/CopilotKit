import { useEffect, useRef } from "react";
import { useChatContext } from "../components";
import { nanoid } from "nanoid";
import { CopilotChatSuggestionConfiguration } from "../types/suggestions";

export function useCopilotChatSuggestion(
  {
    instructions,
    className,
    minSuggestions = 1,
    maxSuggestions = 3,
  }: CopilotChatSuggestionConfiguration,
  dependencies: any[] = [],
) {
  const chatContext = useChatContext();

  useEffect(() => {
    const id = nanoid();

    chatContext.addChatSuggestionConfiguration(id, {
      instructions,
      minSuggestions,
      maxSuggestions,
      className,
    });

    return () => {
      chatContext.removeChatSuggestionConfiguration(id);
    };
  }, dependencies);
}
