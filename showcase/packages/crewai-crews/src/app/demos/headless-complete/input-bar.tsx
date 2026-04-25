"use client";

import React, { useRef } from "react";

export function InputBar({
  value,
  onChange,
  onSubmit,
  onStop,
  isRunning,
  canStop,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isRunning: boolean;
  canStop: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <form
      className="border-t border-[#E9E9EF] p-3 flex gap-2 items-end bg-white"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isRunning ? "Agent is working..." : "Type a message..."}
        disabled={isRunning}
        className="flex-1 resize-none rounded-2xl border border-[#DBDBE5] bg-white px-4 py-2 text-sm leading-6 text-[#010507] focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33] disabled:bg-[#FAFAFC] disabled:text-[#AFAFB7]"
      />
      {canStop ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-full px-4 py-2 text-sm font-medium bg-[#FA5F67] text-white hover:opacity-90 transition-opacity"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={isRunning || value.trim().length === 0}
          className="rounded-full px-4 py-2 text-sm font-medium bg-[#010507] text-white hover:bg-[#2B2B2B] disabled:bg-[#DBDBE5] disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      )}
    </form>
  );
}
