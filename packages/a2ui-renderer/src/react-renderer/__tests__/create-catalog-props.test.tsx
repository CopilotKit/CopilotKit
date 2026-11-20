import React, { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createCatalog } from "../create-catalog";
import { A2UIProvider, useA2UIActions } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import type { A2UIClientEventMessage } from "../types";

// A renderer receives its props resolved by the A2UI binder: bound values as
// their current value, Action props as functions that dispatch the action,
// and a `set<Prop>` setter for every bindable prop. This file is part of
// `check-types`, so the calls below also pin the renderer prop types.
const catalog = createCatalog(
  {
    Dimmer: {
      props: z.object({
        label: CommonSchemas.DynamicString,
        level: CommonSchemas.DynamicNumber,
        changeLevel: CommonSchemas.Action,
      }),
    },
  },
  {
    Dimmer: ({ props }) => {
      const level: number = props.level;
      const label: string = props.label;
      return (
        <input
          type="range"
          aria-label={label}
          value={level ?? 0}
          onChange={(e) => {
            props.setLevel(Number(e.target.value));
            props.changeLevel();
          }}
        />
      );
    },
  },
);

const SURFACE = "dimmer-surface";

function Surface() {
  const { processMessages } = useA2UIActions();
  useEffect(() => {
    processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: SURFACE, catalogId: catalog.id },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: SURFACE,
          components: [
            {
              id: "root",
              component: "Dimmer",
              label: { path: "/name" },
              level: { path: "/level" },
              changeLevel: {
                event: {
                  name: "changeLevel",
                  context: { to: { path: "/level" } },
                },
              },
            },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: SURFACE,
          path: "/",
          value: { name: "Desk lamp", level: 20 },
        },
      },
    ]);
  }, [processMessages]);
  return <A2UIRenderer surfaceId={SURFACE} />;
}

describe("createCatalog renderer props", () => {
  it("receive resolved values, a setter for bound props, and callable actions", async () => {
    const onAction = vi.fn<(message: A2UIClientEventMessage) => void>();
    render(
      <A2UIProvider catalog={catalog} onAction={onAction}>
        <Surface />
      </A2UIProvider>,
    );
    await act(async () => {});

    const slider = screen.getByLabelText("Desk lamp") as HTMLInputElement;
    expect(slider.value).toBe("20");

    await act(async () => {
      fireEvent.change(slider, { target: { value: "65" } });
    });

    // The setter wrote the data model, and the action's context read it back.
    expect(slider.value).toBe("65");
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].userAction).toMatchObject({
      name: "changeLevel",
      surfaceId: SURFACE,
      context: { to: 65 },
    });
  });

  it("still type-check setter arguments", () => {
    createCatalog(
      { Dimmer: { props: z.object({ level: CommonSchemas.DynamicNumber }) } },
      {
        Dimmer: ({ props }) => {
          // @ts-expect-error setLevel takes the resolved type (number)
          props.setLevel("high");
          return null;
        },
      },
    );
  });
});
