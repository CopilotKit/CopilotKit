import type { GenUiInterruptConfig } from "@/app/demos/[integration]/gen-ui-interrupt/config";

// The tool calls Strands' `tool_context.interrupt(...)`. The bridge
// finishes the run with a standard AG-UI interrupt and carries the
// tool's `reason` (the meeting) under `metadata.reason`.
export default {
  mechanism: "interrupt",
  payload: "strands-reason",
  answer: "selection",
} satisfies GenUiInterruptConfig;
