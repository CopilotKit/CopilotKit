import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { A2UIProvider, useA2UIActions } from "../core/A2UIProvider";
import type { A2UIActions } from "../core/store";
import type { OnActionCallback } from "../types";

/**
 * Regression guard for #7906: `A2UIProvider` must hand the promise returned
 * by `onAction` back to the caller, so `surface.dispatchAction(...)` and the
 * provider's `dispatch(...)` resolve only after the app has handled the action.
 */

const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderProvider(onAction: OnActionCallback): A2UIActions {
  let actions: A2UIActions | null = null;
  function Capture() {
    actions = useA2UIActions();
    return null;
  }
  render(
    <A2UIProvider onAction={onAction}>
      <Capture />
    </A2UIProvider>,
  );
  return actions!;
}

describe("A2UIProvider onAction promise", () => {
  afterEach(() => {
    cleanup();
  });

  it("surface.dispatchAction waits for the onAction promise", async () => {
    const log: string[] = [];
    const gate = deferred();
    const actions = renderProvider(async () => {
      log.push("started");
      await gate.promise;
      log.push("finished");
    });

    actions.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "s1", catalogId: BASIC_CATALOG_ID },
      },
    ]);
    const surface = actions.getSurface("s1");
    expect(surface).toBeDefined();

    const dispatched = surface
      .dispatchAction({ event: { name: "toggleSelect", context: {} } }, "root")
      .then(() => log.push("resolved"));

    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["started"]);

    gate.resolve();
    await dispatched;
    expect(log).toEqual(["started", "finished", "resolved"]);
  });

  it("dispatch returns the onAction promise", async () => {
    const log: string[] = [];
    const gate = deferred();
    const actions = renderProvider(async () => {
      log.push("started");
      await gate.promise;
      log.push("finished");
    });

    const dispatched = Promise.resolve(
      actions.dispatch({ userAction: { name: "x", surfaceId: "s1" } }),
    ).then(() => log.push("resolved"));

    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(["started"]);

    gate.resolve();
    await dispatched;
    expect(log).toEqual(["started", "finished", "resolved"]);
  });
});
