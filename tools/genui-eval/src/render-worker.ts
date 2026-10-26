/**
 * Renders surfaces in jsdom, in a worker thread so the jsdom globals never
 * reach the main process (the AI SDK and the runtime must see plain Node).
 * React and jsdom are loaded from react-core's own location, so the
 * engine's source and this file share one copy of React.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import type { RenderRequest, RenderResult, SurfaceCheck } from "./render-check";

const reactCoreRequire = createRequire(
  fileURLToPath(
    new URL("../../../packages/react-core/package.json", import.meta.url),
  ),
);

/** The parts of React, react-dom and jsdom the worker uses (loaded through react-core). */
interface ReactLike {
  createElement(type: unknown, props: unknown, ...children: unknown[]): unknown;
  act(fn: () => unknown): Promise<void>;
}
interface RootLike {
  render(element: unknown): void;
  unmount(): void;
}
interface ReactDomClientLike {
  createRoot(
    container: Element,
    options?: { onUncaughtError?: (error: unknown) => void },
  ): RootLike;
}
interface JsdomLike {
  JSDOM: new (
    html: string,
    options: Record<string, unknown>,
  ) => { window: Window & typeof globalThis };
}

function installDom() {
  const { JSDOM } = reactCoreRequire("jsdom") as JsdomLike;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const g = globalThis as Record<string, unknown>;
  const win = dom.window as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(win)) {
    if (key in g || key.startsWith("_")) continue;
    try {
      Object.defineProperty(g, key, {
        value: win[key],
        configurable: true,
        writable: true,
      });
    } catch {
      // Some window properties cannot be copied; the renderer does not need them.
    }
  }
  g.window = dom.window;
  g.document = dom.window.document;
  const noop = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.ResizeObserver = noop;
  g.IntersectionObserver = noop;
  const matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  win.matchMedia = matchMedia;
  g.matchMedia = matchMedia;
  g.IS_REACT_ACT_ENVIRONMENT = true;
}

/** The components that only show text, and the containers that hold them. */
const TEXT_COMPONENTS = new Set([
  "Text",
  "Title",
  "Caption",
  "Label",
  "Markdown",
  "Bold",
  "Italic",
  "Underline",
  "Strikethrough",
  "Blockquote",
  "Divider",
  "Spacer",
  "List",
  "ListItem",
  "Column",
  "Row",
  "Box",
  "Card",
  "Grid",
  "GridItem",
  "Flow",
  "FlowItem",
]);

installDom();
// Map and Chart load browser libraries after mount; their failures in jsdom
// are not the model's fault and must not end the worker.
process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

const React = reactCoreRequire("react") as ReactLike;
const { createRoot } = reactCoreRequire(
  "react-dom/client",
) as ReactDomClientLike;
const act = React.act;
const [engine, { GenerativeUIRuntimeContext }, { SurfaceView }] =
  await Promise.all([
    import("./engine"),
    import("../../../packages/react-core/src/v2/generative-ui/runtime-context"),
    import("../../../packages/react-core/src/v2/generative-ui/SurfaceView"),
  ]).catch((error: unknown) => {
    parentPort?.postMessage({
      fatal: String((error as Error)?.stack ?? error),
    });
    throw error;
  });

const THREAD = "eval";

async function check(
  surfaces: GenerativeUISurfaceContent[],
): Promise<SurfaceCheck[]> {
  const ui = engine.standardUI;
  const manager = new engine.GenerativeUISurfaceManager(ui);
  const reported: Array<{ componentId: string; message: string }> = [];
  const runtime = {
    manager,
    ui,
    transport: "markdown" as const,
    config: { ui },
    reportError: (info: { componentId?: string; error: unknown }) =>
      reported.push({
        componentId: info.componentId ?? "",
        message:
          info.error instanceof Error ? info.error.message : String(info.error),
      }),
    forwardEvent: async () => ({ ok: true as const, result: undefined }),
    dispatcher: engine.createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
    }),
  };
  const results: SurfaceCheck[] = [];
  for (const content of surfaces) {
    reported.length = 0;
    let crash: string | undefined;
    try {
      manager.ingest(THREAD, "default", content);
    } catch (error) {
      results.push({
        surfaceId: content.surfaceId,
        rendered: false,
        errors: [],
        rejected: [],
        components: [],
        proseOnly: false,
        crash: `ingest: ${(error as Error).message}`,
      });
      continue;
    }
    const surface = manager.getSurface(THREAD, content.surfaceId);
    const described = manager.describeSurfaces(THREAD)[content.surfaceId];
    const rejected = described?.rejected ?? [];
    if (!surface) {
      results.push({
        surfaceId: content.surfaceId,
        rendered: false,
        errors: [],
        rejected,
        components: [],
        proseOnly: false,
        crash: "the surface was not created",
      });
      continue;
    }
    const components = [...surface.model.componentsModel.entries].map(
      ([, component]) => component.type,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container, {
      onUncaughtError: (error: unknown) => {
        crash = error instanceof Error ? error.message : String(error);
      },
    });
    try {
      await act(async () => {
        root.render(
          React.createElement(
            GenerativeUIRuntimeContext.Provider,
            { value: runtime as never },
            React.createElement(SurfaceView, { surface }),
          ),
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    } catch (error) {
      crash = (error as Error).message;
    }
    const errors = [
      ...container.querySelectorAll("[data-generative-ui-error]"),
    ].map((el) => ({
      componentId: el.getAttribute("data-generative-ui-error") ?? "",
      message: (el.textContent ?? "")
        .replace(/^Couldn’t display this part: /, "")
        .trim(),
    }));
    for (const r of reported) {
      if (!errors.some((e) => e.componentId === r.componentId)) errors.push(r);
    }
    const hasRoot = surface.model.componentsModel.get("root") !== undefined;
    results.push({
      surfaceId: content.surfaceId,
      rendered: hasRoot && container.innerHTML.length > 0 && !crash,
      errors,
      rejected,
      components,
      proseOnly:
        components.length > 0 &&
        components.every((c) => TEXT_COMPONENTS.has(c)),
      crash,
    });
    await act(async () => root.unmount());
    container.remove();
  }
  return results;
}

parentPort?.on("message", async (request: RenderRequest) => {
  let result: RenderResult;
  try {
    result = { id: request.id, surfaces: await check(request.surfaces) };
  } catch (error) {
    result = { id: request.id, surfaces: [], error: (error as Error).message };
  }
  parentPort?.postMessage(result);
});
parentPort?.postMessage({ ready: true });
