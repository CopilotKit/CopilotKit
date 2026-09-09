"use client";

import { z } from "zod";
import { createCatalog } from "@copilotkit/a2ui-renderer";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

/**
 * The bookstore a2ui catalog. This is minimal BY DESIGN: the skin ships no
 * `CanvasSurface` and has no OGUI beat, but `catalog` is a REQUIRED `Skin`
 * contract field, so it ships one honest definition — a plain reading-list
 * surface — rather than an empty object.
 */

const definitions = {
  ReadingList: {
    description:
      "A simple titled list of books with authors and prices. Use for a plain list surface when no richer component fits.",
    props: z.object({
      title: z.string(),
      items: z.array(
        z.object({
          title: z.string(),
          author: z.string(),
          price: z.string().optional(),
        }),
      ),
    }),
  },
} satisfies CatalogDefinitions;

export const bookstoreCatalog = createCatalog(
  definitions,
  {
    ReadingList: ({ props }) => {
      const items = Array.isArray(props.items) ? props.items : [];
      return (
        <div className="rounded-md border border-hairline bg-surface p-4">
          <h2 className="bookstore-display text-lg text-ink">{props.title}</h2>
          <ul className="mt-3 divide-y divide-hairline">
            {items.map((item, i) => (
              <li
                key={`${item.title}-${i}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-ink">
                    {item.title}
                  </div>
                  <div className="text-xs text-ink-muted">{item.author}</div>
                </div>
                {item.price ? (
                  <span className="text-sm text-ink-muted">{item.price}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      );
    },
  },
  { catalogId: "bookstore", includeBasicCatalog: false },
);
