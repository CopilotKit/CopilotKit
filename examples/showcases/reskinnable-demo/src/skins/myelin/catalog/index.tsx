"use client";

import { z } from "zod";
import { createCatalog } from "@copilotkit/a2ui-renderer";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

/**
 * Myelin's a2ui catalog. Minimal by design: the journey visuals are
 * `useComponent` cards bound to the live ledger (see tools.tsx), and the skin
 * ships no `CanvasSurface`. `catalog` is a required contract field, so it ships
 * one honest definition — a titled checklist — rather than an empty object.
 */
const definitions = {
  Checklist: {
    description:
      "A titled checklist of short items, e.g. a launch checklist or the steps of a procedure.",
    props: z.object({
      title: z.string(),
      items: z.array(
        z.object({ label: z.string(), done: z.boolean().optional() }),
      ),
    }),
  },
} satisfies CatalogDefinitions;

export const myelinCatalog = createCatalog(
  definitions,
  {
    Checklist: ({ props }) => {
      const items = Array.isArray(props.items) ? props.items : [];
      return (
        <div className="rounded-lg border border-hairline bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">{props.title}</h2>
          <ul className="mt-2 space-y-1.5">
            {items.map((item, i) => (
              <li
                key={`${item.label}-${i}`}
                className="flex items-center gap-2 text-[0.8rem] text-ink"
              >
                <span
                  className={
                    item.done
                      ? "h-3.5 w-3.5 rounded-full bg-positive"
                      : "h-3.5 w-3.5 rounded-full border border-hairline"
                  }
                />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      );
    },
  },
  { catalogId: "myelin", includeBasicCatalog: false },
);
