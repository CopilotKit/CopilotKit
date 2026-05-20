// Docs-only snippet — not imported or rendered. Built-in-agent's
// shared-state-read-write demo at `page.tsx` does its rendering inline
// rather than splitting into a dedicated `preferences-card.tsx`. The
// canonical `/shared-state` doc teaches the split-component shape, so
// this file shows what a minimal PreferencesCard would look like in
// the same shape, so the docs render real teaching code rather than a
// missing-snippet box.
//
// Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

import React from "react";

export interface Preferences {
  name: string;
  tone: "formal" | "casual" | "playful";
}

export interface PreferencesCardProps {
  value: Preferences;
  onChange: (next: Preferences) => void;
}

// @region[preferences-card-render]
// Write-side render: every edit here bubbles up through `onChange`, and
// the parent pipes it straight into `agent.setState({ preferences: ... })`.
// Nothing in this component knows about the agent directly — that's
// intentional: the card is a plain controlled form, and the agent state
// wiring lives one layer up.
export function PreferencesCard({ value, onChange }: PreferencesCardProps) {
  const set = <K extends keyof Preferences>(key: K, v: Preferences[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="rounded border p-4 space-y-3">
      <h2 className="font-semibold">Your preferences</h2>
      <label className="block">
        <span className="text-sm">Name</span>
        <input
          type="text"
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
          className="mt-1 w-full border rounded px-2 py-1"
        />
      </label>
      <label className="block">
        <span className="text-sm">Tone</span>
        <select
          value={value.tone}
          onChange={(e) => set("tone", e.target.value as Preferences["tone"])}
          className="mt-1 w-full border rounded px-2 py-1"
        >
          <option value="formal">Formal</option>
          <option value="casual">Casual</option>
          <option value="playful">Playful</option>
        </select>
      </label>
    </div>
  );
}
// @endregion[preferences-card-render]
