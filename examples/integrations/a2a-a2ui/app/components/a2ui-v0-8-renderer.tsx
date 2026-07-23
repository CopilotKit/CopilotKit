"use client";

import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { z } from "zod";

type A2UIOperation = {
  beginRendering?: { surfaceId?: string };
  surfaceUpdate?: {
    components?: Array<{
      id?: string;
      component?: {
        Text?: {
          text?: { literalString?: string };
        };
      };
    }>;
  };
  dataModelUpdate?: {
    contents?: A2UIDataEntry[];
  };
};

type A2UIDataEntry = {
  key: string;
  valueString?: string;
  valueMap?: A2UIDataEntry[];
};

type Restaurant = {
  name?: string;
  rating?: string;
  detail?: string;
  infoLink?: string;
  imageUrl?: string;
  address?: string;
};

function getOperations(content: unknown): A2UIOperation[] {
  if (!content || typeof content !== "object") {
    return [];
  }

  const payload = content as {
    a2ui_operations?: A2UIOperation[];
    operations?: A2UIOperation[];
  };

  const operations = payload.a2ui_operations ?? payload.operations;
  if (Array.isArray(operations)) {
    return operations;
  }

  if (!operations || typeof operations !== "object") {
    return [];
  }

  if (
    "beginRendering" in operations ||
    "surfaceUpdate" in operations ||
    "dataModelUpdate" in operations
  ) {
    return [operations as A2UIOperation];
  }

  return Object.values(operations).filter(
    (operation): operation is A2UIOperation =>
      !!operation && typeof operation === "object",
  );
}

function getTitle(operations: A2UIOperation[]): string {
  for (const operation of operations) {
    const title = operation.surfaceUpdate?.components?.find(
      (component) => component.id === "title-heading",
    )?.component?.Text?.text?.literalString;

    if (title) {
      return title;
    }
  }

  return "Top Restaurants";
}

function dataEntriesToObject(entries: A2UIDataEntry[] = []): Restaurant {
  return Object.fromEntries(
    entries.map((entry) => [entry.key, entry.valueString ?? ""]),
  );
}

function getRestaurants(operations: A2UIOperation[]): Restaurant[] {
  const dataModel = operations.find(
    (operation) => operation.dataModelUpdate,
  )?.dataModelUpdate;

  const itemsEntry = dataModel?.contents?.find(
    (entry) => entry.key === "items",
  );
  return (itemsEntry?.valueMap ?? []).map((entry) =>
    dataEntriesToObject(entry.valueMap),
  );
}

function readableInfoLink(infoLink: string | undefined): string | null {
  if (!infoLink) {
    return null;
  }

  const match = infoLink.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return match?.[2] ?? infoLink;
}

function A2UIV08Surface({ content }: { content: unknown }) {
  const operations = getOperations(content);
  const restaurants = getRestaurants(operations);
  const title = getTitle(operations);

  if (!operations.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        Generating UI...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="flex flex-col gap-3">
        {restaurants.map((restaurant, index) => (
          <article
            key={`${restaurant.name ?? "restaurant"}-${index}`}
            className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-[144px_1fr]"
          >
            {restaurant.imageUrl ? (
              <img
                src={restaurant.imageUrl}
                alt={restaurant.name ?? "Restaurant"}
                className="h-32 w-full rounded-md object-cover sm:h-full"
              />
            ) : null}
            <div className="flex min-w-0 flex-col gap-2">
              <div>
                <h3 className="text-base font-semibold text-gray-950">
                  {restaurant.name}
                </h3>
                {restaurant.rating ? (
                  <p className="text-sm text-amber-500">{restaurant.rating}</p>
                ) : null}
              </div>
              {restaurant.detail ? (
                <p className="text-sm text-gray-600">{restaurant.detail}</p>
              ) : null}
              {restaurant.address ? (
                <p className="text-xs text-gray-500">{restaurant.address}</p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-2">
                {readableInfoLink(restaurant.infoLink) ? (
                  <a
                    href={readableInfoLink(restaurant.infoLink) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700"
                  >
                    More Info
                  </a>
                ) : null}
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-md bg-[#FF0000] px-3 text-sm font-medium text-white"
                >
                  Book Now
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export const a2uiV08Renderer: ReactActivityMessageRenderer<unknown> = {
  activityType: "a2ui-surface",
  content: z.unknown(),
  render: ({ content }) => <A2UIV08Surface content={content} />,
};
