"use client";
import { z } from "zod";
// TODO(copilotkit-2.0): The A2UI v0.9 client (`@copilotkit/a2ui-renderer`, `@copilotkit/angular/a2ui`) was removed in 2.0. Use generative UI from the framework's `/generative-ui` entry: `createGenerativeUI` and `standardUI` for catalogs, `GenerativeUISurface` for a surface, and `useGenerativeUIState` and `useGenerativeUIFunction` for state and actions. Then delete this import. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
import {
  createCatalog,
  ActionSchema,
} from "@copilotkit/a2ui-renderer";
import { sharedDefinitions } from "./definitions";
import { sharedRenderers } from "./renderers";
import { createGenerativeUI, standardUI, childList } from "@copilotkit/react-core/generative-ui";

export const myCatalog = createGenerativeUI({
  id: "acme/flights",
  extends: [standardUI],
  components: {
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Airport: {
      component: ({ props }) => (
        <div>
          <strong>{props.code}</strong>
          <span>{props.city}</span>
        </div>
      ),
      description: "An airport by IATA code, with its city under it.",
      props: z.object({ code: z.string(), city: z.string() }),
    },
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    // TODO(copilotkit-2.0): Add a `description` to this component. The agent reads it to choose the component. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Price: {
      component: ({ props, dispatch }) => (
        <button onClick={() => dispatch?.({ name: "buy" })}>{props.amount}</button>
      ),
      props: z.object({
        amount: z.number(),
        label: z.string(),
        onSale: z.boolean().optional(),
      }),
    },
    // Drawn between two airports.
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    // TODO(copilotkit-2.0): Add a `description` to this component. The agent reads it to choose the component. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Arrow: {
      component: () => <span aria-hidden="true">→</span>,
      props: z.object({}),
    },
  },
});

export const label: string = "Flights";

export const inlineCatalog = createGenerativeUI({
  id: "copilotkit://custom-catalog",
  components: {
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Badge: {
      component: ({ props }) => <em>{props.text}</em>,
      description: "A small label.",
      props: z.object({ text: z.string() }),
    },
  },
});

// TODO(copilotkit-2.0): This v0.9 binding or action schema has no 2.0 equivalent. A bound prop takes its plain type (the engine resolves `{ "@path" }` before the component renders), and an action becomes an event that the component calls. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#bindings-and-actions
export const cardCatalog = createGenerativeUI({
  id: "copilotkit://custom-catalog",
  components: {
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Card: {
      component: sharedRenderers.Card,
      description: "A card with a title and children.",
      props: z.object({
        title: z.string(),
        children: childList(),
        action: ActionSchema.optional(),
      }),
    },
  },
});

export const sharedCatalog = createGenerativeUI({
  id: "copilotkit://custom-catalog",
  components: {
    // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
    Title: {
      component: ({ props }) => <h1>{props.text}</h1>,
      ...sharedDefinitions.Title,
    },
  },
});

// TODO(copilotkit-2.0): This v0.9 catalog could not be converted automatically. Rewrite it with `createGenerativeUI({ id, extends: [standardUI], components })`, one entry per component with `component`, `description` and plain `props`. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
export const unknownCatalog = createCatalog(sharedDefinitions, sharedRenderers);
