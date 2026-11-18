"use client";

import { useState, useEffect } from "react";

const API_KEY_STORAGE_KEY = "openai_api_key";

export default function ApiKeyInput() {
  const [apiKey, setApiKey] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [showInput, setShowInput] = useState(false);

  useEffect(() => {
    const storedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (storedKey) {
      setApiKey(storedKey);
      setIsConfigured(true);
    } else {
      setShowInput(true);
    }
  }, []);

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
      setIsConfigured(true);
      setShowInput(false);
      window.location.reload(); // Reload to reinitialize CopilotKit with new key
    }
  };

  const handleChange = () => {
    setShowInput(true);
    setIsConfigured(false);
  };

  const handleClear = () => {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    setApiKey("");
    setIsConfigured(false);
    setShowInput(true);
  };

  if (!showInput && isConfigured) {
    return (
      <div className="fixed top-4 left-4 z-50 bg-slate-800 rounded-lg p-3 shadow-lg border border-slate-700">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-slate-300">API Key Configured</span>
          </div>
          <button
            onClick={handleChange}
            className="text-xs text-slate-400 hover:text-slate-200 underline"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-slate-800 rounded-lg p-6 shadow-xl border border-slate-700 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold text-white mb-4">
          OpenAI API Key Required
        </h2>
        <p className="text-sm text-slate-300 mb-4">
          Enter your OpenAI API key to use the World Travel Agent. Your key is
          stored locally and never sent to our servers.
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={!apiKey.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
          >
            Save Key
          </button>
          {isConfigured && (
            <button
              onClick={() => setShowInput(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
        {isConfigured && (
          <button
            onClick={handleClear}
            className="w-full mt-3 text-xs text-red-400 hover:text-red-300 underline"
          >
            Clear saved key
          </button>
        )}
      </div>
    </div>
  );
}

export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}
