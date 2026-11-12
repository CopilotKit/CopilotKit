"use client";
import { demoDefinitions } from "./definitions";
import type { DemoDefinitions } from "./definitions";
import { createGenerativeUI, standardUI } from "@copilotkit/react-core/generative-ui";

export const demoCatalog = createGenerativeUI({
  id: "demo",
  extends: [standardUI.omit(["Row"])],
  components: {
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Row: {
      component: ({ props, children }) => <div>{children(props.children[0])}</div>,
      ...demoDefinitions.Row,
    },
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    DataTable: {
      component: ({ props }) => <table>{props.rows.length}</table>,
      ...demoDefinitions.DataTable,
    },
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    FlightCard: {
      component: ({ props, dispatch }) => (
        <button onClick={() => dispatch(props.action)}>{props.airline}</button>
      ),
      ...demoDefinitions.FlightCard,
    },
  },
});
