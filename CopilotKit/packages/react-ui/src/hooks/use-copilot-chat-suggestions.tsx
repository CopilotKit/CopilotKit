/**
 * A hook for providing suggestions to the user in the Copilot chat.
 */
import { useEffect } from "react";
import { useChatContext } from "../components";
import { nanoid } from "nanoid";
import { CopilotChatSuggestionConfiguration } from "../types/suggestions";

export function useCopilotChatSuggestions(
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
