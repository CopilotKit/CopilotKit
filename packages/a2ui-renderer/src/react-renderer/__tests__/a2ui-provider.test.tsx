import React, { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { A2UIProvider, useA2UIActions } from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";
import type { A2UIActions } from "../core/store";
import type { OnActionCallback } from "../types";

/**
 * A2UIProvider hands out one actions object for its lifetime and routes every
 * action (surface clicks and `dispatch`) to the latest `onAction` prop.
 */

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

const buttonSurface = [
  {
    version: "v0.9",
    createSurface: { surfaceId: "surface", catalogId: BASIC_CATALOG_ID },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "surface",
      components: [
        {
          id: "root",
          component: "Button",
          child: "label",
          action: { event: { name: "go" } },
        },
        { id: "label", component: "Text", text: "Go" },
      ],
    },
  },
];

function Surface({ seen }: { seen: A2UIActions[] }) {
  const actions = useA2UIActions();
  useEffect(() => {
    seen.push(actions);
  });
  useEffect(() => {
    actions.processMessages(buttonSurface as any);
  }, [actions]);
  return <A2UIRenderer surfaceId="surface" />;
}

function renderProvider(onAction: OnActionCallback) {
  const seen: A2UIActions[] = [];
  const utils = render(
    <A2UIProvider onAction={onAction}>
      <Surface seen={seen} />
    </A2UIProvider>,
  );
  const rerenderWith = (next: OnActionCallback) =>
    utils.rerender(
      <A2UIProvider onAction={next}>
        <Surface seen={seen} />
      </A2UIProvider>,
    );
  return { ...utils, seen, rerenderWith };
}

describe("A2UIProvider", () => {
  it("keeps the same actions object across re-renders", () => {
    const view = renderProvider(vi.fn());
    view.rerenderWith(vi.fn());
    view.rerenderWith(vi.fn());

    expect(view.seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(view.seen).size).toBe(1);
  });

  it("dispatch calls the latest onAction", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = renderProvider(first);
    view.rerenderWith(latest);

    const message = { userAction: { name: "manual" } };
    view.seen[0]!.dispatch(message);

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(message);
  });

  it("routes surface actions to the latest onAction", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = renderProvider(first);
    const button = (await view.findByText("Go")).closest("button")!;

    view.rerenderWith(latest);
    fireEvent.click(button);

    await waitFor(() => expect(latest).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
    expect(latest.mock.calls[0]![0]).toMatchObject({
      userAction: { name: "go", surfaceId: "surface" },
    });
  });
});
