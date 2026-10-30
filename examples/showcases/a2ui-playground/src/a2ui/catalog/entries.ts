/**
 * The playground's own components as `createGenerativeUI` entries, with the
 * component supplied by the caller. The app passes the real renderers
 * (`./catalog.ts`); the catalog export passes a stub, so it runs in Node with
 * no DOM, CSS or map libraries.
 */
import type { z } from "zod";
import { definitions, type ComponentName } from "./definitions";

export type OwnEntry<C> = {
  component: C;
  description: string;
  props: z.ZodObject<z.ZodRawShape>;
  events?: Record<string, { description?: string; parameters?: z.ZodTypeAny }>;
  writable?: readonly string[];
};

export function ownEntries<C>(
  componentFor: (name: ComponentName) => C,
): Record<ComponentName, OwnEntry<C>> {
  return Object.fromEntries(
    (Object.keys(definitions) as ComponentName[]).map((name) => {
      const d = definitions[name];
      return [
        name,
        {
          component: componentFor(name),
          description: d.description,
          props: d.props as unknown as z.ZodObject<z.ZodRawShape>,
          ...("events" in d && d.events ? { events: d.events } : {}),
          ...("writable" in d && d.writable ? { writable: d.writable } : {}),
        },
      ];
    }),
  ) as Record<ComponentName, OwnEntry<C>>;
}
