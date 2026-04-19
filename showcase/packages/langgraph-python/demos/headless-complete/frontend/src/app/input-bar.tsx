"use client";

import React, { useRef } from "react";

/**
 * Composer for the headless chat.
 *
 * A textarea plus a Send / Stop toggle. Enter submits; Shift+Enter inserts a
 * newline. The textarea is disabled while the agent is running so users can't
 * pile up concurrent turns.
 */
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
      className="border-t border-gray-200 p-3 flex gap-2 items-end"
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
        className="flex-1 resize-none rounded-2xl border border-gray-300 px-4 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
      />
      {canStop ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-full px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={isRunning || value.trim().length === 0}
          className="rounded-full px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Send
        </button>
      )}
    </form>
  );
}
