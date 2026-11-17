import type { GenUiInterruptConfig } from "@/app/demos/[integration]/gen-ui-interrupt/config";

// The CrewAI flow pauses with a standard AG-UI interrupt and puts the
// meeting under `metadata.crewai.output`.
export default {
  mechanism: "interrupt",
  payload: "crewai-output",
  answer: "selection",
} satisfies GenUiInterruptConfig;
