"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ChatInputContextType {
  inputValue: string;
  setInputValue: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement> | null;
  setInputRef: (ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement>) => void;
}

const ChatInputContext = createContext<ChatInputContextType | null>(null);

export function ChatInputProvider({ children }: { children: ReactNode }) {
  const [inputValue, setInputValue] = useState("");
  const [inputRef, setInputRef] = useState<React.RefObject<HTMLInputElement | HTMLTextAreaElement> | null>(null);

  return (
    <ChatInputContext.Provider value={{ inputValue, setInputValue, inputRef, setInputRef }}>
      {children}
    </ChatInputContext.Provider>
  );
}

export function useChatInput() {
  const context = useContext(ChatInputContext);
  if (!context) {
    throw new Error("useChatInput must be used within ChatInputProvider");
  }
  return context;
}
