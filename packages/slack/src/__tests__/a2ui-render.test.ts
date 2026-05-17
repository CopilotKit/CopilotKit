import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createCatalog,
  createA2UIActivityRenderer,
  applyA2UIOperations,
  renderA2UISurface,
  type CatalogRenderers,
  type A2UIOperation,
} from "../index.js";

const DynString = z.union([z.string(), z.object({ path: z.string() })]);

// Mini catalog mirroring the python showcase flight schema: a Row whose
// children template-iterates an array, rendering one FlightCard per item.
const definitions = {
  Row: {
    props: z.object({
      gap: z.number().optional(),
      children: z.any(),
    }),
  },
  FlightCard: {
    props: z.object({
      airline: DynString,
      price: DynString,
    }),
  },
} as const;

const renderers: CatalogRenderers<typeof definitions> = {
  Row: ({ props, children }) => {
    // Flatten all child component renders into one block list.
    const kids = props.children as
      | string[]
      | Array<{ id: string; basePath?: string }>;
    return (kids ?? []).flatMap((c) =>
      typeof c === "string" ? children(c) : children(c.id, c.basePath),
    );
  },
  FlightCard: ({ props }) => [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${String(props.airline)}* — ${String(props.price)}`,
      },
    },
  ],
};

const CATALOG_ID = "copilotkit://test-flights";
const catalog = createCatalog(definitions, renderers, {
  catalogId: CATALOG_ID,
});

const SURFACE_ID = "flight-search-results";

function flightOps(flights: Array<{ airline: string; price: string }>) {
  const ops: A2UIOperation[] = [
    { createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
    {
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          {
            id: "root",
            component: "Row",
            children: { componentId: "flight-card", path: "/flights" },
          },
          {
            id: "flight-card",
            component: "FlightCard",
            airline: { path: "airline" },
            price: { path: "price" },
          },
        ],
      },
    },
    { updateDataModel: { surfaceId: SURFACE_ID, value: { flights } } },
  ];
  return ops;
}

describe("renderA2UISurface end-to-end", () => {
  it("expands template-children across the data model and binds props", () => {
    const surfaces = applyA2UIOperations(
      flightOps([
        { airline: "United", price: "$289" },
        { airline: "Delta", price: "$317" },
      ]),
    );
    const surface = surfaces.get(SURFACE_ID)!;
    const blocks = renderA2UISurface(surface, catalog, (a) =>
      JSON.stringify(a),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "*United* — $289" },
    });
    expect(blocks[1]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "*Delta* — $317" },
    });
  });

  it("emits no blocks when the bound array is empty", () => {
    const surfaces = applyA2UIOperations(flightOps([]));
    const blocks = renderA2UISurface(surfaces.get(SURFACE_ID)!, catalog, (a) =>
      JSON.stringify(a),
    );
    expect(blocks).toEqual([]);
  });

  it("silently skips components without a renderer in this catalog", () => {
    const surfaces = applyA2UIOperations([
      { createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
      {
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: [{ id: "root", component: "UnknownComponent" }],
        },
      },
    ]);
    const blocks = renderA2UISurface(surfaces.get(SURFACE_ID)!, catalog, (a) =>
      JSON.stringify(a),
    );
    expect(blocks).toEqual([]);
  });
});

describe("createA2UIActivityRenderer", () => {
  it("renders an activity message with a2ui_operations into blocks", () => {
    const renderer = createA2UIActivityRenderer({ catalog });
    expect(renderer.activityType).toBe("a2ui-surface");

    // Validate content schema accepts the wire shape and the render
    // pipeline produces the expected blocks.
    const content = {
      a2ui_operations: flightOps([{ airline: "American", price: "$201" }]),
    };
    const parsed = renderer.content!.safeParse(content);
    expect(parsed.success).toBe(true);

    const blocks = renderer.render({
      activityType: "a2ui-surface",
      content: parsed.data!,
      message: {
        id: "act1",
        role: "activity",
        activityType: "a2ui-surface",
        content,
      },
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "*American* — $201" },
    });
  });

  it("ignores surfaces with a different catalogId", () => {
    const renderer = createA2UIActivityRenderer({ catalog });
    const ops: A2UIOperation[] = [
      {
        createSurface: {
          surfaceId: "other",
          catalogId: "copilotkit://some-other-catalog",
        },
      },
      {
        updateComponents: {
          surfaceId: "other",
          components: [
            { id: "root", component: "FlightCard", airline: "X", price: "$1" },
          ],
        },
      },
    ];
    const blocks = renderer.render({
      activityType: "a2ui-surface",
      content: { a2ui_operations: ops },
      message: {
        id: "act2",
        role: "activity",
        activityType: "a2ui-surface",
        content: { a2ui_operations: ops },
      },
    });
    expect(blocks).toEqual([]);
  });

  it("threads encodeAction through to renderers via the dispatch hook", () => {
    // A button-bearing component to exercise the dispatch path.
    const localDefs = {
      Btn: { props: z.object({ action: z.any() }) },
    } as const;
    const localRenderers: CatalogRenderers<typeof localDefs> = {
      Btn: ({ props, dispatch }) => [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Go" },
              action_id: "a2ui:btn",
              value: dispatch!.encodeAction(props.action as any),
            },
          ],
        },
      ],
    };
    const cat = createCatalog(localDefs, localRenderers, {
      catalogId: "copilotkit://btn",
    });
    const calls: unknown[] = [];
    const renderer = createA2UIActivityRenderer({
      catalog: cat,
      encodeAction: (a) => {
        calls.push(a);
        return `ENC:${JSON.stringify(a)}`;
      },
    });

    const ops: A2UIOperation[] = [
      {
        createSurface: { surfaceId: "s1", catalogId: "copilotkit://btn" },
      },
      {
        updateComponents: {
          surfaceId: "s1",
          components: [
            {
              id: "root",
              component: "Btn",
              action: { event: { name: "click", context: { id: 7 } } },
            },
          ],
        },
      },
    ];
    const blocks = renderer.render({
      activityType: "a2ui-surface",
      content: { a2ui_operations: ops },
      message: {
        id: "x",
        role: "activity",
        activityType: "a2ui-surface",
        content: { a2ui_operations: ops },
      },
    });

    const button = (blocks[0] as { elements: Array<{ value: string }> })
      .elements[0]!;
    // Encoded payload matches the A2UIUserAction shape with surfaceId +
    // sourceComponentId injected by the walker, so the bridge can
    // forward it as `forwardedProps.a2uiAction.userAction` without remap.
    expect(button.value).toBe(
      `ENC:${JSON.stringify({
        name: "click",
        surfaceId: "s1",
        sourceComponentId: "root",
        context: { id: 7 },
      })}`,
    );
    expect(calls).toHaveLength(1);
  });
});
