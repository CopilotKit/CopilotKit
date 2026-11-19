"use client";

import { useEffect, useRef, useState } from "react";
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  GenerativeUISurface,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import { createCatalogAgent, sampleSurfaceId } from "./catalog/catalog-agent";
import { SAMPLES } from "./catalog/samples";

/** The sample the empty chat shows: a Slider bound to Text and a Chart. */
const PLATE_TITLE =
  "Function values: formatString, calc, series, formatCurrency";
const PLATE_SAMPLE =
  SAMPLES.find((sample) => sample.title === PLATE_TITLE) ?? SAMPLES[0];

/** Streams the plate's surface once, from the scripted agent. */
function StartPlate() {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void copilotkit.runAgent({ agent });
  }, [copilotkit, agent]);
  return null;
}

/**
 * A live standard component surface, rendered in the browser from the
 * operations a model would write. No model and no runtime: a scripted agent
 * streams it, as on /catalog. It has its own provider so it never touches the
 * chat's thread.
 */
export function SpecimenPlate() {
  const [agents] = useState(() => ({
    default: createCatalogAgent([PLATE_SAMPLE], standardUI.id),
  }));
  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={agents}
      generativeUI={{ ui: standardUI }}
    >
      <StartPlate />
      <GenerativeUISurface
        id={sampleSurfaceId(0)}
        fallback={<p className="ck-loading">Loading the example…</p>}
      />
    </CopilotKitProvider>
  );
}
