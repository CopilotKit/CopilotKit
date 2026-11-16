"use client";

import { useCallback, useState } from "react";
import { DEFAULT_AGENT_CONFIG } from "./config-types";
import type { Expertise, ResponseLength, Tone } from "./config-types";

/** The config knobs of the demo, starting at `DEFAULT_AGENT_CONFIG`. */
export function useAgentConfig() {
  const [config, setConfig] = useState(DEFAULT_AGENT_CONFIG);

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

  return { config, setTone, setExpertise, setResponseLength };
}
