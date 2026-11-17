import type { GenUiInterruptConfig } from "@/app/demos/[integration]/gen-ui-interrupt/config";

// The tool is marked `needs_approval`, so the Agents SDK pauses the run
// before the tool runs. The interrupt carries the call's arguments
// under `metadata.tool_input`, and the run resumes with `{ approved }`.
export default {
  mechanism: "interrupt",
  payload: "tool-input",
  answer: "approval",
} satisfies GenUiInterruptConfig;
