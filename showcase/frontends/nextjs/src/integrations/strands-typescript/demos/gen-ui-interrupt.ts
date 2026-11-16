import type { GenUiInterruptConfig } from "@/app/demos/[integration]/gen-ui-interrupt/config";

// The tool calls Strands' `context.interrupt(...)`. The bridge finishes
// the run with a standard AG-UI interrupt and carries the tool's
// `reason` (the meeting) under `metadata.reason` or JSON-encoded in
// `message`, depending on the bridge version.
export default {
  mechanism: "interrupt",
  payload: "strands-reason",
  answer: "selection",
} satisfies GenUiInterruptConfig;
