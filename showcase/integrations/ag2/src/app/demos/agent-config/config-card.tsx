"use client";

import type { ChangeEvent } from "react";
import {
  type AgentConfig,
  EXPERTISE_OPTIONS,
  type Expertise,
  RESPONSE_LENGTH_OPTIONS,
  type ResponseLength,
  TONE_OPTIONS,
  type Tone,
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
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Tone</span>
          <select
            data-testid="agent-config-tone-select"
            value={config.tone}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onToneChange(e.target.value as Tone)
            }
            className="rounded border border-[var(--border)] bg-[var(--bg-muted)] px-2 py-1 text-sm"
          >
            {TONE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Expertise</span>
          <select
            data-testid="agent-config-expertise-select"
            value={config.expertise}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onExpertiseChange(e.target.value as Expertise)
            }
            className="rounded border border-[var(--border)] bg-[var(--bg-muted)] px-2 py-1 text-sm"
          >
            {EXPERTISE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Response length</span>
          <select
            data-testid="agent-config-length-select"
            value={config.responseLength}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onResponseLengthChange(e.target.value as ResponseLength)
            }
            className="rounded border border-[var(--border)] bg-[var(--bg-muted)] px-2 py-1 text-sm"
          >
            {RESPONSE_LENGTH_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
