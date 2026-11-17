import { fireEvent, render, screen } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import type { Component, PropType } from "vue";
import { z } from "zod";
import type {
  A2UIComponentNode,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import { SurfaceBoundary } from "../boundaries";
import { SurfaceView } from "../SurfaceView";
import type { GenerativeUIRuntime } from "../runtime-context";
import {
  createRuntimeProvider,
  createTestRuntime,
} from "./helpers/render-surface";

// The React boundaries have no suite of their own; their behavior is pinned
// in React's surface-view suite, ported in surface-view.test.ts. These cases
// pin what the Vue boundaries add or translate.

/** What `Bomb` throws while armed; `undefined` renders it. */
let thrown: unknown;

const Bomb = defineComponent({
  props: { label: { type: String, required: true } },
  setup(props) {
    return () => {
      if (thrown !== undefined) throw thrown;
      return h("span", `survived ${props.label}`);
    };
  },
});
const SetupBomb = defineComponent({
  setup() {
    throw new Error("setup exploded");
  },
});
const Grid = defineComponent({
  template: `<div data-testid="grid"><slot name="children" /></div>`,
});
const Label = defineComponent({
  props: { label: { type: String, required: true } },
  template: `<span>{{ label }}</span>`,
});

const ui = createGenerativeUI({
  id: "boundaries",
  components: {
    Grid: { component: Grid, slots: { children: "multiple" } },
    Bomb: { component: Bomb, props: z.object({ label: z.string() }) },
    SetupBomb: { component: SetupBomb },
    Text: { component: Label, props: z.object({ label: z.string() }) },
  },
});

/** The content of surface `surfaceId` with `components`. */
function surfaceContent(
  surfaceId: string,
  components: A2UIComponentNode[],
): GenerativeUISurfaceContent {
  return {
    surfaceId,
    target: "inline",
    catalogId: ui.id,
    operations: [
      { version: "1.0", createSurface: { surfaceId, catalogId: ui.id } },
      { version: "1.0", updateComponents: { surfaceId, components } },
    ],
    status: "ready",
    rejected: [],
  };
}

/** Renders surface `surfaceId` of thread "t1", and follows the manager. */
function renderSurface(runtime: GenerativeUIRuntime, surfaceId: string) {
  const Provider = createRuntimeProvider(runtime);
  const surface = ref(runtime.manager.getSurface("t1", surfaceId));
  runtime.manager.subscribe(() => {
    surface.value = runtime.manager.getSurface("t1", surfaceId);
  });
  render(
    defineComponent({
      setup: () => () =>
        h(Provider, null, {
          default: () =>
            surface.value ? h(SurfaceView, { surface: surface.value }) : null,
        }),
    }),
  );
}

/** Renders one surface with `components`, and an app error handler spy. */
function renderNodes(components: A2UIComponentNode[], fallback?: Component) {
  const { runtime, reportError } = createTestRuntime(ui, fallback);
  runtime.manager.ingest("t1", "default", surfaceContent("s1", components));
  const surface = runtime.manager.getSurface("t1", "s1");
  const Provider = createRuntimeProvider(runtime);
  const errorHandler = vi.fn();
  render(
    defineComponent({
      components: { Provider, SurfaceView },
      setup: () => ({ surface }),
      template: `<Provider><SurfaceView :surface="surface" /></Provider>`,
    }),
    { global: { config: { errorHandler } } },
  );
  return { reportError, errorHandler };
}

const grid = (...children: A2UIComponentNode[]) => [
  {
    id: "root",
    component: "Grid",
    children: children.map((node) => node.id),
  },
  ...children,
];
const ok: A2UIComponentNode = { id: "ok", component: "Text", label: "Fine" };

describe("generated UI error boundaries (Vue-specific semantics)", () => {
  afterEach(() => {
    thrown = undefined;
    vi.restoreAllMocks();
  });
  /** A component that throws in setup has no render; Vue warns about it. */
  const silenceMissingRender = () =>
    vi.spyOn(console, "warn").mockImplementation(() => {});

  it("shows the default fallback with the message and a Retry button that renders the component again", async () => {
    thrown = new Error("exploded");
    const { reportError, errorHandler } = renderNodes(
      grid({ id: "bomb", component: "Bomb", label: "b1" }, ok),
    );
    await nextTick();
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-generative-ui-error")).toBe("bomb");
    expect(alert.textContent).toBe("Couldn’t display this part: explodedRetry");
    expect(screen.getByText("Fine")).toBeTruthy();
    expect(reportError).toHaveBeenCalledExactlyOnceWith({
      kind: "render",
      surfaceId: "s1",
      componentId: "bomb",
      error: thrown,
    });
    expect(errorHandler).not.toHaveBeenCalled();

    thrown = undefined;
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("survived b1")).toBeTruthy();
  });

  it("gives the host fallback the error, retry, surfaceId and componentId", async () => {
    const Fallback = defineComponent({
      props: {
        error: { type: Error, required: true },
        retry: { type: Function as PropType<() => void>, required: true },
        surfaceId: { type: String, required: true },
        componentId: { type: String, required: true },
      },
      template: `<p role="status">{{ surfaceId }}/{{ componentId }}: {{ error.message }}</p>`,
    });
    thrown = new Error("exploded");
    renderNodes([{ id: "root", component: "Bomb", label: "b1" }], Fallback);
    await nextTick();
    expect(screen.getByRole("status").textContent).toBe("s1/root: exploded");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("turns a thrown value that is not an Error into an Error", async () => {
    thrown = "plain string";
    const { reportError } = renderNodes([
      { id: "root", component: "Bomb", label: "b1" },
    ]);
    await nextTick();
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn’t display this part: plain string",
    );
    const [info] = reportError.mock.calls[0]!;
    expect(info.error).toBeInstanceOf(Error);
    expect(info.error?.message).toBe("plain string");
  });

  it("isolates a component that throws in setup", async () => {
    silenceMissingRender();
    const { reportError } = renderNodes(
      grid({ id: "bomb", component: "SetupBomb" }, ok),
    );
    await nextTick();
    expect(screen.getByRole("alert").textContent).toContain("setup exploded");
    expect(screen.getByText("Fine")).toBeTruthy();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "render", componentId: "bomb" }),
    );
  });

  it("keeps an error of the app fallback inside its node: the default fallback stands in, with Retry", async () => {
    silenceMissingRender();
    const Fallback = defineComponent({
      setup() {
        throw new Error("fallback exploded");
      },
    });
    thrown = new Error("exploded");
    const { reportError, errorHandler } = renderNodes(
      grid({ id: "bomb", component: "Bomb", label: "b1" }, ok),
      Fallback,
    );
    await nextTick();
    await nextTick();
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-generative-ui-error")).toBe("bomb");
    expect(alert.textContent).toBe("Couldn’t display this part: explodedRetry");
    expect(screen.getByText("Fine")).toBeTruthy();
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenNthCalledWith(1, {
      kind: "render",
      surfaceId: "s1",
      componentId: "bomb",
      error: thrown,
    });
    const [info] = reportError.mock.calls[1]!;
    expect(info).toMatchObject({
      kind: "render",
      surfaceId: "s1",
      componentId: "bomb",
    });
    expect(info.error.message).toBe(
      "The error fallback of bomb threw: fallback exploded",
    );
    expect((info.error.cause as Error).message).toBe("fallback exploded");
    expect(errorHandler).not.toHaveBeenCalled();

    thrown = undefined;
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("survived b1")).toBeTruthy();
  });

  it("keeps a thrown value that is not an Error as the cause, also a falsy one", async () => {
    const ThrowsUndefined = defineComponent({
      setup() {
        return () => {
          throw undefined;
        };
      },
    });
    const throwingUI = createGenerativeUI({
      id: "boundaries",
      components: { Bomb: { component: ThrowsUndefined } },
    });
    const { runtime, reportError } = createTestRuntime(throwingUI);
    runtime.manager.ingest(
      "t1",
      "default",
      surfaceContent("s1", [{ id: "root", component: "Bomb" }]),
    );
    renderSurface(runtime, "s1");
    await nextTick();
    expect(screen.getByRole("alert")).toBeTruthy();
    const [info] = reportError.mock.calls[0]!;
    expect(info.error).toBeInstanceOf(Error);
    expect(info.error.message).toBe(
      "A value that is not an Error was thrown: undefined",
    );
    expect("cause" in info.error).toBe(true);
    expect(info.error.cause).toBeUndefined();
  });

  it("reports a failure that stays the same across new revisions once, and a different one again", async () => {
    thrown = new Error("exploded");
    const { runtime, reportError } = createTestRuntime(ui);
    const send = (label: string) =>
      runtime.manager.ingest(
        "t1",
        "default",
        surfaceContent(
          "s1",
          grid({ id: "bomb", component: "Bomb", label }, ok),
        ),
      );
    send("b1");
    renderSurface(runtime, "s1");
    await nextTick();
    expect(reportError).toHaveBeenCalledTimes(1);

    send("b2");
    await nextTick();
    await nextTick();
    expect(screen.getByRole("alert").textContent).toContain("exploded");
    expect(reportError).toHaveBeenCalledTimes(1);

    thrown = new Error("another failure");
    send("b3");
    await nextTick();
    await nextTick();
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls[1]![0].error.message).toBe("another failure");

    // A render without the failure clears what the node reported.
    thrown = undefined;
    send("b4");
    await nextTick();
    await nextTick();
    expect(screen.getByText("survived b4")).toBeTruthy();
    thrown = new Error("another failure");
    send("b5");
    await nextTick();
    await nextTick();
    expect(reportError).toHaveBeenCalledTimes(3);
  });
});

describe("SurfaceBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resets on a new revision, and reports a failure that stays the same once", async () => {
    let fail = true;
    const Child = defineComponent({
      setup() {
        return () => {
          if (fail) throw new Error("root failed");
          return h("span", "surface content");
        };
      },
    });
    const { runtime, reportError } = createTestRuntime(ui);
    const Provider = createRuntimeProvider(runtime);
    const revision = ref(0);
    render(
      defineComponent({
        setup: () => () =>
          h(Provider, null, {
            default: () =>
              h(
                SurfaceBoundary,
                { surfaceId: "s1", revision: revision.value },
                { default: () => h(Child) },
              ),
          }),
      }),
    );
    await nextTick();
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-generative-ui-error")).toBe("surface");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);

    revision.value += 1;
    await nextTick();
    await nextTick();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(reportError).toHaveBeenCalledTimes(1);

    fail = false;
    revision.value += 1;
    await nextTick();
    await nextTick();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("surface content")).toBeTruthy();
  });
});
