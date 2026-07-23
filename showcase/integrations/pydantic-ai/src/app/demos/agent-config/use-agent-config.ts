"use client";

import { useCallback, useState } from "react";
import {
  type AgentConfig,
  DEFAULT_AGENT_CONFIG,
  type Expertise,
  type ResponseLength,
  type Tone,
} from "./config-types";

export interface UseAgentConfigHandle {
  config: AgentConfig;
  setTone: (tone: Tone) => void;
  setExpertise: (expertise: Expertise) => void;
  setResponseLength: (length: ResponseLength) => void;
  reset: () => void;
}

export function useAgentConfig(): UseAgentConfigHandle {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_AGENT_CONFIG);

  const setTone = useCallback(
    (tone: Tone) => setConfig((prev) => ({ ...prev, tone })),
    [],
  );
  const setExpertise = useCallback(
    (expertise: Expertise) => setConfig((prev) => ({ ...prev, expertise })),
    [],
  );
  const setResponseLength = useCallback(
    (responseLength: ResponseLength) =>
      setConfig((prev) => ({ ...prev, responseLength })),
    [],
  );
  const reset = useCallback(() => setConfig(DEFAULT_AGENT_CONFIG), []);

  return { config, setTone, setExpertise, setResponseLength, reset };
}
