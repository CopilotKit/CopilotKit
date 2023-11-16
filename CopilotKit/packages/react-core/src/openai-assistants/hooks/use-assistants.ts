"use client";

import { useState } from "react";
import { processMessageStream } from "../utils/process-message-stream";
import { Message } from "../types/shared";
import { getStreamStringTypeAndValue } from "../utils/shared";

export type AssistantStatus = "in_progress" | "awaiting_message";

export function useAssistant_experimental({
  api,
  threadId: threadIdParam,
}: {
  api: string;
  threadId?: string | undefined;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<AssistantStatus>("awaiting_message");
  const [error, setError] = useState<unknown | undefined>(undefined);

  const handleInputChange = (e: any) => {
    setInput(e.target.value);
  };

  const submitMessage = async (e: any) => {
    e.preventDefault();

    if (input === "") {
      return;
    }

    setStatus("in_progress");

    setMessages((messages) => [
      ...messages,
      { id: "", role: "user", content: input },
    ]);

    setInput("");

    const result = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // always use user-provided threadId when available:
        threadId: threadIdParam ?? threadId ?? null,
        message: input,
      }),
    });

    if (result.body == null) {
      throw new Error("The response body is empty.");
    }

    await processMessageStream(result.body.getReader(), (message: string) => {
      try {
        const { type, value } = getStreamStringTypeAndValue(message);
        const messageContent = value as any;

        switch (type) {
          case "text": {
            // append message:
            setMessages((messages) => [
              ...messages,
              {
                id: messageContent.id,
                role: messageContent.role,
                content: messageContent.content[0].text.value,
              },
            ]);

            break;
          }
          case "error": {
            setError(messageContent);
            break;
          }
          case "control_data": {
            setThreadId(messageContent.threadId);

            // set id of last message:
            setMessages((messages) => {
              const lastMessage = messages[messages.length - 1];
              lastMessage.id = messageContent.messageId;
              return [...messages.slice(0, messages.length - 1), lastMessage];
            });

            break;
          }
        }
      } catch (error) {
        setError(error);
      }
    });

    setStatus("awaiting_message");
  };

  return {
    messages,
    input,
    handleInputChange,
    submitMessage,
    status,
    error,
  };
}
