import type { GenUiInterruptConfig } from "@/app/demos/[integration]/gen-ui-interrupt/config";

// The tool `suspend()`s, and the @ag-ui/mastra bridge sends the suspend
// payload (the meeting) inside a `mastra_suspend` wrapper.
export default {
  mechanism: "interrupt",
  payload: "mastra-suspend",
  answer: "selection",
} satisfies GenUiInterruptConfig;
