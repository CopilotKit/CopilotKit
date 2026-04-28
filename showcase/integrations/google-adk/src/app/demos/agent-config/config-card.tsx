"use client";

import React from "react";

export interface AgentConfigValue {
  tone: "warm" | "neutral" | "playful";
  expertise: "beginner" | "intermediate" | "expert";
  response_length: "short" | "medium" | "long";
  language: string;
}

export const INITIAL_CONFIG: AgentConfigValue = {
  tone: "neutral",
  expertise: "intermediate",
  response_length: "medium",
  language: "English",
};

export function ConfigCard({
  value,
  onChange,
}: {
  value: AgentConfigValue;
  onChange: (next: AgentConfigValue) => void;
}) {
  const set = <K extends keyof AgentConfigValue>(
    key: K,
    v: AgentConfigValue[K],
  ) => onChange({ ...value, [key]: v });

  return (
    <div
      data-testid="config-card"
      className="rounded-2xl border border-[#DBDBE5] bg-white p-5 shadow-sm space-y-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-[#010507]">Agent config</h3>
        <p className="text-xs text-[#838389] mt-1">
          Forwarded to the agent on every turn via shared state.
        </p>
      </div>
      <Select
        label="Tone"
        value={value.tone}
        onChange={(v) => set("tone", v as AgentConfigValue["tone"])}
        options={[
          { value: "warm", label: "Warm" },
          { value: "neutral", label: "Neutral" },
          { value: "playful", label: "Playful" },
        ]}
      />
      <Select
        label="Expertise"
        value={value.expertise}
        onChange={(v) => set("expertise", v as AgentConfigValue["expertise"])}
        options={[
          { value: "beginner", label: "Beginner-friendly" },
          { value: "intermediate", label: "Intermediate" },
          { value: "expert", label: "Expert" },
        ]}
      />
      <Select
        label="Response length"
        value={value.response_length}
        onChange={(v) =>
          set("response_length", v as AgentConfigValue["response_length"])
        }
        options={[
          { value: "short", label: "Short" },
          { value: "medium", label: "Medium" },
          { value: "long", label: "Long" },
        ]}
      />
      <Select
        label="Language"
        value={value.language}
        onChange={(v) => set("language", v)}
        options={[
          { value: "English", label: "English" },
          { value: "Spanish", label: "Spanish" },
          { value: "French", label: "French" },
          { value: "Japanese", label: "Japanese" },
        ]}
      />
      <div className="pt-3 border-t border-[#E9E9EF]">
        <pre
          data-testid="config-state-json"
          className="bg-[#FAFAFC] border border-[#E9E9EF] rounded-lg p-2.5 text-xs text-[#010507] overflow-x-auto font-mono"
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#57575B]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-[#DBDBE5] rounded-xl px-3 py-2 text-sm text-[#010507] bg-white focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
