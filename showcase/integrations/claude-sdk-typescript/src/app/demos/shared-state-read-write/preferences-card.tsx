"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./_components/card";
import { Badge } from "./_components/badge";
import { Input, Label, Select } from "./_components/input";

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
    <Card data-testid="preferences-card" className="w-full">
      <CardHeader>
        <CardTitle>Your preferences</CardTitle>
        <CardDescription>
          These are written into agent state. The agent reads them on every
          turn.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="pref-name">Name</Label>
          <Input
            id="pref-name"
            data-testid="pref-name"
            type="text"
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Atai"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="pref-tone">Tone</Label>
            <Select
              id="pref-tone"
              data-testid="pref-tone"
              value={value.tone}
              onChange={(e) =>
                set("tone", e.target.value as Preferences["tone"])
              }
            >
              <option value="formal">Formal</option>
              <option value="casual">Casual</option>
              <option value="playful">Playful</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pref-language">Language</Label>
            <Select
              id="pref-language"
              data-testid="pref-language"
              value={value.language}
              onChange={(e) => set("language", e.target.value)}
            >
              <option>English</option>
              <option>Spanish</option>
              <option>French</option>
              <option>German</option>
              <option>Japanese</option>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Interests</Label>
          <div className="flex flex-wrap gap-2">
            {INTEREST_OPTIONS.map((interest) => {
              const selected = (value.interests ?? []).includes(interest);
              return (
                <button
                  key={interest}
                  type="button"
                  onClick={() => toggleInterest(interest)}
                  className="focus:outline-none"
                >
                  <Badge
                    variant={selected ? "selected" : "outline"}
                    className="cursor-pointer"
                  >
                    {interest}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[#838389]">
          Shared state
        </div>
        <pre
          data-testid="pref-state-json"
          className="bg-[#FAFAFC] border border-[#E9E9EF] rounded-lg p-3 text-xs text-[#010507] overflow-x-auto font-mono min-h-[140px] whitespace-pre"
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      </CardFooter>
    </Card>
  );
}
// @endregion[preferences-card-render]
