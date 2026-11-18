/**
 * PromptPill - Clickable suggestion pill
 *
 * Shows example prompts users can try. Clicking sends the message to the chat.
 */

"use client";

import { useState } from "react";
import { useSendMessage } from "../hooks/useSendMessage";

interface PromptPillProps {
  prompt: string;
}

export function PromptPill({ prompt }: PromptPillProps) {
  const { sendMessage } = useSendMessage();
  const [sending, setSending] = useState(false);

  const handleClick = async () => {
    if (sending) return;
    setSending(true);
    try {
      await sendMessage(prompt);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={sending}
      className="prompt-pill cursor-pointer hover:scale-105 transition-transform disabled:opacity-50"
      title="Click to send to chat"
    >
      {sending ? "Sending..." : prompt}
    </button>
  );
}
