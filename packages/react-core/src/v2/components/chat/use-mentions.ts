import { useCallback, useRef, useState } from "react";
import type { CopilotChatMentionItem } from "./mentions";

/** Manages the mention selections attached to the next submitted message. */
export function useMentions() {
  const [mentions, setMentions] = useState<CopilotChatMentionItem[]>([]);
  const mentionsRef = useRef(mentions);
  mentionsRef.current = mentions;

  const selectMention = useCallback((item: CopilotChatMentionItem) => {
    setMentions((current) =>
      current.some((mention) => mention.id === item.id)
        ? current
        : [...current, item],
    );
  }, []);

  const removeMention = useCallback((id: string) => {
    setMentions((current) => current.filter((mention) => mention.id !== id));
  }, []);

  const consumeMentions = useCallback(() => {
    const selected = mentionsRef.current;
    if (selected.length === 0) return selected;
    setMentions([]);
    return selected;
  }, []);

  return {
    mentions,
    selectMention,
    removeMention,
    consumeMentions,
  };
}
