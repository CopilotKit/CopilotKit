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
 * Sidebar card — the only place where the user edits their preferences.
 *
 * Every change invokes `onChange`, which the parent page routes straight
 * into `agent.setState({ preferences: ... })`. On the next turn, the
 * Strands backend's `state_context_builder` reads that same object out of
 * `input_data.state` and prepends it to the user message so the agent's
 * reply visibly adapts.
 */
// @region[preferences-card-render]
// Write-side render: every edit here bubbles up through `onChange`, and
// the parent pipes it straight into `agent.setState({ preferences: ... })`.
// Nothing in this component knows about the agent directly — that's
// intentional: the card is a plain controlled form, and the agent state
// wiring lives one layer up.
export function PreferencesCard({ value, onChange }: PreferencesCardProps) {
  const set = <K extends keyof Preferences>(key: K, v: Preferences[K]) =>
    onChange({ ...value, [key]: v });

  const toggleInterest = (interest: string) => {
    const has = (value.interests ?? []).includes(interest);
    set(
      "interests",
      has
        ? (value.interests ?? []).filter((i) => i !== interest)
        : [...(value.interests ?? []), interest],
    );
  };

  return (
    <div
      data-testid="preferences-card"
      className="w-full max-w-md p-6 bg-white rounded-2xl shadow-sm border border-[#DBDBE5] space-y-5"
    >
      <div>
        <h2 className="text-xl font-semibold text-[#010507]">
          Your preferences
        </h2>
        <p className="text-xs text-[#57575B] mt-1">
          These are written into agent state. The agent reads them on every
          turn.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-[#57575B]">Name</span>
        <input
          data-testid="pref-name"
          type="text"
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Atai"
          className="mt-1 w-full border border-[#DBDBE5] rounded-xl px-3 py-2 text-sm text-[#010507] focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33]"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-[#57575B]">Tone</span>
        <select
          data-testid="pref-tone"
          value={value.tone}
          onChange={(e) => set("tone", e.target.value as Preferences["tone"])}
          className="mt-1 w-full border border-[#DBDBE5] rounded-xl px-3 py-2 text-sm text-[#010507] bg-white focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33]"
        >
          <option value="formal">Formal</option>
          <option value="casual">Casual</option>
          <option value="playful">Playful</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-[#57575B]">Language</span>
        <select
          data-testid="pref-language"
          value={value.language}
          onChange={(e) => set("language", e.target.value)}
          className="mt-1 w-full border border-[#DBDBE5] rounded-xl px-3 py-2 text-sm text-[#010507] bg-white focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33]"
        >
          <option>English</option>
          <option>Spanish</option>
          <option>French</option>
          <option>German</option>
          <option>Japanese</option>
        </select>
      </label>

      <div>
        <span className="text-sm font-medium text-[#57575B]">Interests</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((interest) => {
            const selected = (value.interests ?? []).includes(interest);
            return (
              <button
                key={interest}
                type="button"
                onClick={() => toggleInterest(interest)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  selected
                    ? "bg-[#BEC2FF1A] text-[#010507] border-[#BEC2FF]"
                    : "bg-white text-[#57575B] border-[#DBDBE5] hover:bg-[#FAFAFC]"
                }`}
              >
                {interest}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-3 border-t border-[#E9E9EF]">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[#838389] mb-1.5">
          Shared state
        </div>
        <pre
          data-testid="pref-state-json"
          className="bg-[#FAFAFC] border border-[#E9E9EF] rounded-lg p-2.5 text-xs text-[#010507] overflow-x-auto font-mono"
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    </div>
  );
}
// @endregion[preferences-card-render]
