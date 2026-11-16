import type { GenUiInterruptConfig } from "@/app/demos/[integration]/gen-ui-interrupt/config";

// LangGraph's `interrupt()` pauses the graph, and the bridge sends the
// meeting as the value of the `on_interrupt` event.
export default {
  mechanism: "interrupt",
  payload: "event-value",
  answer: "selection",
} satisfies GenUiInterruptConfig;
