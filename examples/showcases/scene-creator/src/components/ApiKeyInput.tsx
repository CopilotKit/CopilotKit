"use client";

import { useState } from "react";

interface ApiKeyInputProps {
  currentKey: string;
  onSave: (key: string) => void;
  onClear: () => void;
}

export function ApiKeyInput({ currentKey, onSave, onClear }: ApiKeyInputProps) {
  const [input, setInput] = useState("");
  const [isEditing, setIsEditing] = useState(!currentKey);

  const handleSave = () => {
    if (input.trim()) {
      onSave(input.trim());
      setInput("");
      setIsEditing(false);
    }
  };

  const handleClear = () => {
    onClear();
    setInput("");
    setIsEditing(true);
  };

  if (!isEditing && currentKey) {
    return (
      <div className="brutalist-card p-3 bg-[var(--accent-blue)] max-w-xs">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🔑</span>
          <div className="text-xs font-mono opacity-70">
            {currentKey.substring(0, 8)}...
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="brutalist-btn bg-white px-2 py-1 text-xs"
          >
            CHANGE
          </button>
          <button
            onClick={handleClear}
            className="brutalist-btn bg-[var(--accent-red)] text-black px-2 py-1 text-xs"
          >
            CLEAR
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="brutalist-card p-3 bg-[var(--accent-yellow)] max-w-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🔑</span>
        <div className="font-bold uppercase text-xs">API KEY</div>
      </div>
      <div className="mb-2 text-xs opacity-80">
        Enter your Google AI API key
      </div>
      <div className="space-y-2">
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="AIza..."
          className="w-full px-2 py-1.5 border-2 border-black bg-white font-mono text-xs focus:outline-none focus:shadow-[3px_3px_0px_0px_black]"
          autoFocus
        />
        <div className="flex gap-1">
          <button
            onClick={handleSave}
            disabled={!input.trim()}
            className="flex-1 brutalist-btn bg-[var(--accent-blue)] text-black px-2 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            SAVE
          </button>
          {currentKey && (
            <button
              onClick={() => setIsEditing(false)}
              className="brutalist-btn bg-white px-2 py-1 text-xs"
            >
              CANCEL
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
