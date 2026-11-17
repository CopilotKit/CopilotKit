import type { InterruptHeadlessConfig } from "@/app/demos/[integration]/interrupt-headless/config";

// The CrewAI flow pauses with a standard AG-UI interrupt and puts the
// meeting under `metadata.crewai.output`.
export default {
  mechanism: "interrupt",
  payload: "crewai-output",
  answer: "selection",
} satisfies InterruptHeadlessConfig;
