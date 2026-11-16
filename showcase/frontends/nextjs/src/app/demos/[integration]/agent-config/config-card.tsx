"use client";

import {
  EXPERTISE_OPTIONS,
  RESPONSE_LENGTH_OPTIONS,
  TONE_OPTIONS,
} from "./config-types";
import type {
  AgentConfig,
  Expertise,
  ResponseLength,
  Tone,
} from "./config-types";

interface ConfigCardProps {
  config: AgentConfig;
  onToneChange: (tone: Tone) => void;
  onExpertiseChange: (expertise: Expertise) => void;
  onResponseLengthChange: (length: ResponseLength) => void;
}

export function ConfigCard({
  config,
  onToneChange,
  onExpertiseChange,
  onResponseLengthChange,
}: ConfigCardProps) {
  return (
    <div
      data-testid="agent-config-card"
      className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm"
    >
      <h2 className="text-sm font-semibold">Agent Config</h2>
      <p className="text-xs text-[var(--text-muted)]">
        Change these and send a message to see the agent adapt.
      </p>
      <div className="flex flex-wrap gap-3">
        <ConfigSelect
          label="Tone"
          testId="agent-config-tone-select"
          value={config.tone}
          options={TONE_OPTIONS}
          onChange={onToneChange}
        />
        <ConfigSelect
          label="Expertise"
          testId="agent-config-expertise-select"
          value={config.expertise}
          options={EXPERTISE_OPTIONS}
          onChange={onExpertiseChange}
        />
        <ConfigSelect
          label="Response length"
          testId="agent-config-length-select"
          value={config.responseLength}
          options={RESPONSE_LENGTH_OPTIONS}
          onChange={onResponseLengthChange}
        />
      </div>
    </div>
  );
}

interface ConfigSelectProps<Option extends string> {
  label: string;
  testId: string;
  value: Option;
  options: readonly Option[];
  onChange: (value: Option) => void;
}

// One labelled <select>. The selected value is looked up in `options`, so
// `onChange` only ever gets one of them.
function ConfigSelect<Option extends string>({
  label,
  testId,
  value,
  options,
  onChange,
}: ConfigSelectProps<Option>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      <select
        data-testid={testId}
        value={value}
        onChange={(event) => {
          const selected = options.find(
            (option) => option === event.target.value,
          );
          if (selected !== undefined) onChange(selected);
        }}
        className="rounded border border-[var(--border)] bg-[var(--bg-muted)] px-2 py-1 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
