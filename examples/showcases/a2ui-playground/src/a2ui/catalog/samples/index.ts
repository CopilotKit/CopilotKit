import { A2UI_VERSION } from "@copilotkit/shared";
import type { ComponentName } from "../definitions";
import { chartsSamples } from "./charts";
import { contentSamples } from "./content";
import { dataSamples } from "./data";
import { domainSamples } from "./domain";
import { feedbackSamples } from "./feedback";
import { inputsSamples } from "./inputs";
import { layoutSamples } from "./layout";
import { mapsSamples } from "./maps";
import { standardSamples } from "./standard";
import type { Sample } from "./types";

export const samples: Partial<Record<ComponentName, Sample>> = {
  ...layoutSamples,
  ...contentSamples,
  ...dataSamples,
  ...chartsSamples,
  ...mapsSamples,
  ...inputsSamples,
  ...feedbackSamples,
  ...domainSamples,
};

export { standardSamples };

/** The preview for a playground component or, failing that, a Gen UI 2.0 standard component. */
export function sampleFor(name: string): Sample | undefined {
  if (Object.hasOwn(samples, name)) return samples[name as ComponentName];
  return Object.hasOwn(standardSamples, name) ? standardSamples[name] : undefined;
}

export function sampleOps(name: string, sample: Sample, catalogId: string) {
  const surfaceId = `preview-${name}`;
  return [{ version: A2UI_VERSION, createSurface: { surfaceId, catalogId, components: sample.components, ...(sample.data ? { dataModel: sample.data } : {}) } }];
}
