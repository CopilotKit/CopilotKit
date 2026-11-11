import React from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
} from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";

const LEGACY_CATALOG = "https://a2ui.org/specification/v0_9/basic_catalog.json";
const NATIVE_CATALOG =
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

function setup() {
  let actions!: ReturnType<typeof useA2UIActions>;
  function Surface() {
    actions = useA2UIActions();
    const error = useA2UIError();
    return (
      <>
        {error && <div role="alert">{error}</div>}
        <A2UIRenderer surfaceId="s" />
      </>
    );
  }
  const view = render(
    <A2UIProvider>
      <Surface />
    </A2UIProvider>,
  );
  return { ...view, actions };
}

function createLegacy(actions: ReturnType<typeof useA2UIActions>) {
  act(() =>
    actions.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "s", catalogId: LEGACY_CATALOG },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Text", text: { path: "/name" } },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "s", value: { name: "Legacy" } },
      },
    ]),
  );
}

describe("provider payload protocol contract", () => {
  it("preserves SDK-supported legacy minor-version compatibility across separate calls", () => {
    const view = setup();
    act(() =>
      view.actions.processMessages([
        {
          version: "v0.9.1",
          createSurface: { surfaceId: "s", catalogId: LEGACY_CATALOG },
        },
      ]),
    );
    act(() =>
      view.actions.processMessages([
        {
          version: "v0.9.1",
          updateComponents: {
            surfaceId: "s",
            components: [
              { id: "root", component: "Text", text: { path: "/name" } },
            ],
          },
        },
      ]),
    );
    act(() =>
      view.actions.processMessages([
        {
          version: "v0.9.1",
          updateDataModel: { surfaceId: "s", value: { name: "Compatible" } },
        },
      ]),
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Compatible")).toBeTruthy();
    act(() =>
      view.actions.processMessages([
        { version: "v0.9.1", deleteSurface: { surfaceId: "s" } },
      ]),
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.actions.getSurface("s")).toBeUndefined();
  });

  it.each(["updateDataModel", "updateComponents", "deleteSurface"])(
    "does not let wrapped %s bypass a surface's protocol",
    (kind) => {
      const view = setup();
      createLegacy(view.actions);
      const payload =
        kind === "updateDataModel"
          ? { surfaceId: "s", value: { name: "Wrong version" } }
          : kind === "updateComponents"
            ? {
                surfaceId: "s",
                components: [
                  { id: "root", component: "Text", text: "Wrong version" },
                ],
              }
            : { surfaceId: "s" };
      act(() =>
        view.actions.processMessages([
          { messages: [{ version: "1.0", [kind]: payload }] },
        ]),
      );
      expect(view.getByRole("alert").textContent).toMatch(/version/i);
      expect(view.getByText("Legacy")).toBeTruthy();
      expect(view.queryByText("Wrong version")).toBeNull();
    },
  );

  it("preserves the wrapper's SDK-inherited native version on later unversioned messages", () => {
    const view = setup();
    act(() =>
      view.actions.processMessages([
        {
          messages: [
            {
              version: "1.0",
              createSurface: { surfaceId: "s", catalogId: NATIVE_CATALOG },
            },
            {
              updateComponents: {
                surfaceId: "s",
                components: [
                  { id: "root", component: "Text", text: { "@path": "/name" } },
                ],
              },
            },
            {
              updateDataModel: {
                surfaceId: "s",
                value: { name: "Native wrapper" },
              },
            },
          ],
        },
      ]),
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Native wrapper")).toBeTruthy();
  });

  it("preserves unversioned legacy wrappers on the existing default", () => {
    const view = setup();
    act(() =>
      view.actions.processMessages([
        {
          messages: [
            { createSurface: { surfaceId: "s", catalogId: LEGACY_CATALOG } },
            {
              updateComponents: {
                surfaceId: "s",
                components: [
                  { id: "root", component: "Text", text: "Legacy default" },
                ],
              },
            },
          ],
        },
      ]),
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Legacy default")).toBeTruthy();
  });

  it("keeps strict native envelope validation inside wrappers", () => {
    const view = setup();
    act(() =>
      view.actions.processMessages([
        {
          messages: [
            {
              version: "1.0",
              surfaceId: "noncanonical",
              createSurface: { surfaceId: "s", catalogId: NATIVE_CATALOG },
            },
          ],
        },
      ]),
    );
    expect(view.getByRole("alert").textContent).toMatch(
      /surfaceId|Unrecognized/,
    );
    expect(view.actions.getSurface("s")).toBeUndefined();
  });
});
