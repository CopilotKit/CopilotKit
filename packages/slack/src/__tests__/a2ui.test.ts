import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createCatalog,
  type CatalogDefinitions,
  type CatalogRenderers,
} from "../index.js";

describe("createCatalog", () => {
  it("returns a tagged record with catalogId, definitions, renderers", () => {
    const definitions = {
      Greeting: {
        description: "A friendly hello.",
        props: z.object({ name: z.string() }),
      },
    } satisfies CatalogDefinitions;

    const renderers: CatalogRenderers<typeof definitions> = {
      Greeting: ({ props }) => [
        {
          type: "section",
          text: { type: "mrkdwn", text: `Hello, *${props.name}*!` },
        },
      ],
    };

    const cat = createCatalog(definitions, renderers, {
      catalogId: "copilotkit://test",
    });

    expect(cat.catalogId).toBe("copilotkit://test");
    expect(cat.definitions).toBe(definitions);
    expect(cat.renderers).toBe(renderers);
  });

  it("falls back to a default catalogId when none is given", () => {
    const definitions = {
      X: { props: z.object({}) },
    } satisfies CatalogDefinitions;
    const renderers: CatalogRenderers<typeof definitions> = {
      X: () => [],
    };
    const cat = createCatalog(definitions, renderers);
    expect(cat.catalogId).toMatch(/^copilotkit:\/\//);
  });

  it("invokes a renderer producing the expected Block Kit blocks", () => {
    const definitions = {
      Title: {
        props: z.object({ text: z.string() }),
      },
    } satisfies CatalogDefinitions;

    const renderers: CatalogRenderers<typeof definitions> = {
      Title: ({ props }) => [
        {
          type: "header",
          text: { type: "plain_text", text: props.text, emoji: true },
        },
      ],
    };

    const cat = createCatalog(definitions, renderers);
    const Title = cat.renderers.Title;
    expect(Title).toBeDefined();
    const blocks = Title!({
      props: { text: "Hi" },
      // ComponentContext is required by the type but unused by this
      // particular renderer — minimal mock keeps the unit test focused
      // on the renderer's own logic.
      context: {} as never,
      children: () => [],
    });

    expect(blocks).toEqual([
      {
        type: "header",
        text: { type: "plain_text", text: "Hi", emoji: true },
      },
    ]);
  });

  it("renderer can use dispatch.encodeAction to pack a payload", () => {
    const definitions = {
      ClickMe: {
        props: z.object({ id: z.string() }),
      },
    } satisfies CatalogDefinitions;

    const renderers: CatalogRenderers<typeof definitions> = {
      ClickMe: ({ props, dispatch }) => [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Go" },
              action_id: `a2ui:${props.id}`,
              value:
                dispatch?.encodeAction({
                  event: { name: "click", context: { id: props.id } },
                }) ?? "",
            },
          ],
        },
      ],
    };

    const cat = createCatalog(definitions, renderers);

    // Verify the renderer threads encodeAction through correctly.
    const encodeAction = (a: unknown) => `enc:${JSON.stringify(a)}`;
    const ClickMe = cat.renderers.ClickMe;
    expect(ClickMe).toBeDefined();
    const blocks = ClickMe!({
      props: { id: "42" },
      context: {} as never,
      children: () => [],
      dispatch: { encodeAction },
    });

    const button = (blocks[0] as { elements: Array<{ value: string }> })
      .elements[0]!;
    expect(button.value).toBe(
      `enc:${JSON.stringify({ event: { name: "click", context: { id: "42" } } })}`,
    );
  });
});
