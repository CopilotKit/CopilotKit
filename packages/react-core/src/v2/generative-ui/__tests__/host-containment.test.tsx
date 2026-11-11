import React from "react";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ComponentModel } from "@a2ui/web_core/state";
import { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import { createGenerativeUI } from "../catalog";
import { domGenerativeUIHost } from "../host";
import type { GenerativeUIHost } from "../host";
import { SurfaceView } from "../SurfaceView";
import {
  createHarness,
  expectContained,
  hostThrowingFor,
  reported,
  S,
} from "./containment-harness";

let bombArmed = true;

function Label({ label }: { label: string }) {
  return <span data-testid="label">{label}</span>;
}
function Bomb({ label }: { label: string }): ReactNode {
  if (bombArmed) throw new Error("component exploded");
  return <span data-testid="survivor">survived {label}</span>;
}
function Box({ children }: { children?: ReactNode }) {
  return <div data-testid="box">{children}</div>;
}

const ui = createGenerativeUI({
  id: "host-containment",
  components: {
    Text: { component: Label, props: z.object({ label: z.string() }) },
    Bomb: { component: Bomb, props: z.object({ label: z.string() }) },
    Box: { component: Box, slots: { children: "multiple" } },
  },
});

const { create, nodes, content, renderWithHost } = createHarness(
  ui,
  "host-containment",
);

describe("host element failures stay inside the surface", () => {
  beforeEach(() => {
    bombArmed = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("contains an error thrown by the host's SurfaceRoot and shows the surface fallback", () => {
    const host: GenerativeUIHost = {
      ...domGenerativeUIHost,
      SurfaceRoot: () => {
        throw new Error("root exploded");
      },
    };
    const { reportError, onEscape } = renderWithHost(host, {
      id: "root",
      component: "Text",
      label: "hello",
    });
    expectContained(onEscape);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-generative-ui-error")).toBe("surface");
    expect(reported(reportError)).toEqual([
      {
        kind: "render",
        surfaceId: S,
        error: expect.objectContaining({ message: "root exploded" }),
      },
    ]);
  });

  it("brings the surface back after a SurfaceRoot failure, on retry and on a new revision", () => {
    let rootArmed = true;
    const Root = domGenerativeUIHost.SurfaceRoot;
    const host: GenerativeUIHost = {
      ...domGenerativeUIHost,
      SurfaceRoot: (props) => {
        if (rootArmed) throw new Error("root exploded");
        return <Root {...props} />;
      },
    };
    const { push } = renderWithHost(host, {
      id: "root",
      component: "Text",
      label: "v1",
    });
    expect(screen.queryByTestId("label")).toBeNull();
    // A new revision while the root still throws keeps the fallback.
    push({ id: "root", component: "Text", label: "v2" });
    expect(screen.queryByTestId("label")).toBeNull();
    rootArmed = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("label").textContent).toBe("v2");

    rootArmed = true;
    push({ id: "root", component: "Text", label: "v3" });
    expect(screen.queryByTestId("label")).toBeNull();
    rootArmed = false;
    push({ id: "root", component: "Text", label: "v4" });
    expect(screen.getByTestId("label").textContent).toBe("v4");
  });

  it("keeps a surface-level fallback inside the web root, with its marker, class and theme", () => {
    // A lookup that throws in the root's NodeView fails outside any node
    // boundary: the whole surface falls back, as before the host existed.
    const { container, onEscape } = renderWithHost(
      domGenerativeUIHost,
      { id: "root", component: "Text", label: "hello" },
      { theme: { "--a2ui-color-accent": "#d97706" }, armLookups: true },
    );
    expectContained(onEscape);
    const root = container.querySelector(`[data-generative-ui-root="${S}"]`);
    expect(root).not.toBeNull();
    expect(root!.className).toBe("a2ui-surface");
    expect(root!.getAttribute("data-a2ui-theme")).toBeTruthy();
    expect(root!.querySelector("style")?.textContent).toContain("#d97706");
    const alert = root!.querySelector('[role="alert"]');
    expect(alert?.getAttribute("data-generative-ui-error")).toBe("surface");
    // No Retry here: the web output is the one from before the host.
    expect(alert?.querySelector("button")).toBeNull();
  });

  it("resets a surface-level failure when the agent sends a new revision", () => {
    const { components, push } = renderWithHost(
      domGenerativeUIHost,
      { id: "root", component: "Text", label: "v1" },
      { armLookups: true },
    );
    expect(
      screen.getByRole("alert").getAttribute("data-generative-ui-error"),
    ).toBe("surface");
    components.armed = false;
    push({ id: "root", component: "Text", label: "v2" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("label").textContent).toBe("v2");
  });

  it("contains an error thrown by the host's NodeFallback and reports the fallback's own error", () => {
    const host = hostThrowingFor("root");
    const { reportError, onEscape } = renderWithHost(host, {
      id: "root",
      component: "Bomb",
      label: "boom",
    });
    expectContained(onEscape);
    const errors = reported(reportError);
    // The component's error and the fallback's, nothing else.
    expect(errors).toHaveLength(2);
    expect(errors).toContainEqual(
      expect.objectContaining({
        kind: "render",
        surfaceId: S,
        componentId: "root",
        error: expect.objectContaining({
          message: expect.stringContaining("fallback exploded for root"),
        }),
      }),
    );
    // The component's own error is reported too, and the two are told apart.
    const ownError = errors.find(
      (info) => info.error.message === "component exploded",
    );
    const fallbackError = errors.find((info) =>
      info.error.message.includes("fallback exploded for root"),
    );
    expect(ownError).toMatchObject({ kind: "render", componentId: "root" });
    expect(fallbackError?.error.message).toBe(
      "The error fallback of root threw: fallback exploded for root",
    );
    expect(fallbackError?.error.cause).toBeInstanceOf(Error);
    expect(fallbackError?.error.cause).toMatchObject({
      message: "fallback exploded for root",
    });
  });

  it("contains a throwing app errorFallback to its node and shows the host fallback with Retry", () => {
    const { reportError, onEscape } = renderWithHost(
      domGenerativeUIHost,
      [
        { id: "root", component: "Box", children: ["bomb", "ok"] },
        { id: "bomb", component: "Bomb", label: "b1" },
        { id: "ok", component: "Text", label: "still here" },
      ],
      {
        errorFallback: () => {
          throw new Error("app fallback exploded");
        },
      },
    );
    expectContained(onEscape);
    expect(screen.getByTestId("label").textContent).toBe("still here");
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-generative-ui-error")).toBe("bomb");
    expect(alert.textContent).toContain("component exploded");
    const errors = reported(reportError);
    expect(errors).toHaveLength(2);
    expect(errors).toContainEqual({
      kind: "render",
      surfaceId: S,
      componentId: "bomb",
      error: expect.objectContaining({ message: "component exploded" }),
    });
    expect(errors).toContainEqual({
      kind: "render",
      surfaceId: S,
      componentId: "bomb",
      error: expect.objectContaining({
        message: "The error fallback of bomb threw: app fallback exploded",
      }),
    });
    bombArmed = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("survivor").textContent).toBe("survived b1");
  });

  it("contains a node whose component, app errorFallback and host NodeFallback all throw", () => {
    const { reportError, onEscape } = renderWithHost(
      hostThrowingFor("bomb"),
      [
        { id: "root", component: "Box", children: ["bomb", "ok"] },
        { id: "bomb", component: "Bomb", label: "b1" },
        { id: "ok", component: "Text", label: "still here" },
      ],
      {
        errorFallback: () => {
          throw new Error("app fallback exploded");
        },
      },
    );
    expectContained(onEscape);
    expect(screen.getByTestId("label").textContent).toBe("still here");
    const messages = reported(reportError).map((info) => [
      info.kind,
      info.componentId,
      info.error.message,
    ]);
    expect(messages).toHaveLength(3);
    expect(messages).toEqual(
      expect.arrayContaining([
        ["render", "bomb", "component exploded"],
        [
          "render",
          "bomb",
          "The error fallback of bomb threw: app fallback exploded",
        ],
        [
          "render",
          "bomb",
          "The error fallback of bomb threw: fallback exploded for bomb",
        ],
      ]),
    );
  });

  it("contains a throwing host NodeFallback for an unknown component to that node", () => {
    const { onEscape, reportError } = renderWithHost(
      hostThrowingFor("u"),
      [
        { id: "root", component: "Box", children: ["u", "ok"] },
        { id: "ok", component: "Text", label: "still here" },
      ],
      {
        prepare: (manager) =>
          manager
            .getSurface("t1", S)!
            .model.componentsModel.addComponent(
              new ComponentModel("u", "Nope", {}),
            ),
      },
    );
    expectContained(onEscape);
    expect(screen.getByTestId("label").textContent).toBe("still here");
    expect(screen.queryByRole("alert")).toBeNull();
    // Only the fallback's error: the unknown type itself is not reported.
    expect(reported(reportError)).toEqual([
      {
        kind: "render",
        surfaceId: S,
        componentId: "u",
        error: expect.objectContaining({
          message: "The error fallback of u threw: fallback exploded for u",
        }),
      },
    ]);
  });

  it("contains a throwing host NodeFallback for a cyclic reference to that node", () => {
    const { onEscape, reportError } = renderWithHost(hostThrowingFor("a"), [
      { id: "root", component: "Box", children: ["a", "ok"] },
      { id: "a", component: "Box", children: ["b"] },
      { id: "b", component: "Box", children: ["a"] },
      { id: "ok", component: "Text", label: "still here" },
    ]);
    expectContained(onEscape);
    expect(screen.getByTestId("label").textContent).toBe("still here");
    // root, a and b all still render their box.
    expect(screen.getAllByTestId("box")).toHaveLength(3);
    expect(screen.queryByRole("alert")).toBeNull();
    // The throwing fallback of the cyclic "a" is reported, once; the cycle
    // itself and the nodes around it report nothing.
    expect(reported(reportError)).toEqual([
      {
        kind: "render",
        surfaceId: S,
        componentId: "a",
        error: expect.objectContaining({
          message: "The error fallback of a threw: fallback exploded for a",
        }),
      },
    ]);
  });

  it("shows the fallback again on a new revision after the fallback itself failed", () => {
    let fallbackArmed = true;
    const Default = domGenerativeUIHost.NodeFallback;
    const host: GenerativeUIHost = {
      ...domGenerativeUIHost,
      NodeFallback: (props) => {
        if (fallbackArmed) throw new Error("fallback exploded");
        return <Default {...props} />;
      },
    };
    const { push } = renderWithHost(host, {
      id: "root",
      component: "Bomb",
      label: "v1",
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fallbackArmed = false;
    // The component still throws with the new props; its fallback now works.
    push({ id: "root", component: "Bomb", label: "v2" });
    expect(screen.getByRole("alert").textContent).toContain(
      "component exploded",
    );
    bombArmed = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("survivor").textContent).toBe("survived v2");
  });

  it("names both providers when the runtime is missing", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    act(() =>
      manager.ingest(
        "t1",
        "default",
        content([create, nodes({ id: "root", component: "Text", label: "x" })]),
      ),
    );
    let thrown: unknown;
    try {
      render(<SurfaceView surface={manager.getSurface("t1", S)!} />);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("<CopilotKitProvider generativeUI={{ ui }}>");
    expect(message).toContain("<GenerativeUIProvider>");
    expect(message).toContain("@copilotkit/react-native/generative-ui");
  });
});
