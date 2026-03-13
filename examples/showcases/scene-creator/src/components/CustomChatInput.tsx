"use client";

import { type InputProps } from "@copilotkit/react-ui";
import { useChatInput } from "@/lib/chat-input-context";
import { useEffect, useRef } from "react";

export function CustomChatInput({ inProgress, onSend }: InputProps) {
  const { inputValue, setInputValue, setInputRef } = useChatInput();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Register the input ref with context so other components can focus it
  useEffect(() => {
    setInputRef(inputRef as any);
  }, [setInputRef]);

  // Focus and move cursor to end when value changes externally
  useEffect(() => {
    if (inputValue && inputRef.current) {
      inputRef.current.focus();
      // Move cursor to end
      const length = inputValue.length;
      inputRef.current.setSelectionRange(length, length);
    }
  }, [inputValue]);

  const handleSubmit = () => {
    if (inputValue.trim()) {
      onSend(inputValue);
      setInputValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex gap-2 p-4 border-t-2 border-black bg-[var(--bg-primary)]">
      <textarea
        ref={inputRef}
        disabled={inProgress}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="ENTER COMMAND..."
        rows={1}
        className="flex-1 px-4 py-3 brutalist-input text-sm resize-none disabled:bg-neutral-200"
        style={{ minHeight: "50px", maxHeight: "150px" }}
      />
      <button
        disabled={inProgress || !inputValue.trim()}
        onClick={handleSubmit}
        className="brutalist-btn bg-[var(--accent-red)] text-black px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm tracking-widest"
      >
        TRANSMIT
      </button>
    </div>
  );
}
