"use client";

import React from "react";

// Data model the UI writes into agent state via agent.setState()
export interface Preferences {
  name: string;
  tone: "formal" | "casual" | "playful";
  language: string;
  interests: string[];
}

export const INTEREST_OPTIONS = [
  "Cooking",
  "Travel",
  "Tech",
  "Music",
  "Sports",
  "Books",
  "Movies",
];

export interface PreferencesCardProps {
  value: Preferences;
  onChange: (next: Preferences) => void;
}

/**
 * Sidebar card — the *only* place where the user edits their preferences.
 *
 * Every change invokes `onChange`, which the parent page routes straight into
 * `agent.setState({ preferences: ... })`. On the next turn, the backend's
 * `PreferencesInjectorMiddleware` reads that same object out of agent state
 * and injects it into the system prompt, so the agent's reply visibly adapts.
 */
export function PreferencesCard({ value, onChange }: PreferencesCardProps) {
  const set = <K extends keyof Preferences>(key: K, v: Preferences[K]) =>
    onChange({ ...value, [key]: v });

  const toggleInterest = (interest: string) => {
    const has = value.interests.includes(interest);
    set(
      "interests",
      has
        ? value.interests.filter((i) => i !== interest)
        : [...value.interests, interest],
    );
  };

  return (
    <div
      data-testid="preferences-card"
      className="w-full max-w-md p-6 bg-white rounded-2xl shadow-lg border border-gray-100 space-y-5"
    >
      <div>
        <h2 className="text-xl font-bold text-gray-800">Your Preferences</h2>
        <p className="text-xs text-gray-500 mt-1">
          These are written into agent state. The agent reads them on every
          turn.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Name</span>
        <input
          data-testid="pref-name"
          type="text"
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Atai"
          className="mt-1 w-full border rounded px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Tone</span>
        <select
          data-testid="pref-tone"
          value={value.tone}
          onChange={(e) => set("tone", e.target.value as Preferences["tone"])}
          className="mt-1 w-full border rounded px-3 py-2 text-sm"
        >
          <option value="formal">Formal</option>
          <option value="casual">Casual</option>
          <option value="playful">Playful</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Language</span>
        <select
          data-testid="pref-language"
          value={value.language}
          onChange={(e) => set("language", e.target.value)}
          className="mt-1 w-full border rounded px-3 py-2 text-sm"
        >
          <option>English</option>
          <option>Spanish</option>
          <option>French</option>
          <option>German</option>
          <option>Japanese</option>
        </select>
      </label>

      <div>
        <span className="text-sm font-medium text-gray-700">Interests</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((interest) => {
            const selected = value.interests.includes(interest);
            return (
              <button
                key={interest}
                type="button"
                onClick={() => toggleInterest(interest)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  selected
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {interest}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-3 border-t border-gray-100">
        <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
          Shared State
        </div>
        <pre
          data-testid="pref-state-json"
          className="bg-gray-50 rounded p-2 text-xs text-gray-700 overflow-x-auto"
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    </div>
  );
}
