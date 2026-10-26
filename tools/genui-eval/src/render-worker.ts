/**
 * Renders surfaces in jsdom, in a worker thread so the jsdom globals never
 * reach the main process (the AI SDK and the runtime must see plain Node).
 * React and jsdom are loaded from react-core's own location, so the
 * engine's source and this file share one copy of React.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";
import { childIdsAtRefs } from "@copilotkit/shared";
import type { ChildRef, GenerativeUISurfaceContent } from "@copilotkit/shared";
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

/** A data path read against the scope of a template item: absolute, or relative to `base`. */
function resolvePath(path: string, base: string | undefined) {
  if (path.startsWith("/") || base === undefined)
    return path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/$/, "")}/${path}`;
}

/** The production resolver of dynamic values, set once the engine is loaded. */
let resolveDynamic:
  | ((
      value: unknown,
      context: {
        data: { get(path: string): unknown };
        basePath: string | undefined;
      },
    ) => { ok: boolean; value?: unknown })
  | undefined;

/**
 * `value` with its dynamic values (`{"@path"}`, `{"@call"}`, at any depth)
 * resolved by the renderer's own resolver, so computed child references
 * count like literal ones. A value that cannot be resolved stays as written.
 */
function resolveBound(
  value: unknown,
  data: { get(path: string): unknown },
  base: string | undefined,
): unknown {
  if (!resolveDynamic) return value;
  const resolved = resolveDynamic(value, { data, basePath: base });
  return resolved.ok ? resolved.value : value;
}

/**
 * The children one slot or reference value renders, each with the data
 * scope it renders in: an id or a list of ids in the same scope, or a
 * template, which renders its component once per item of its list (none
 * for an empty list) in the scope of the item.
 */
function childrenOf(
  value: unknown,
  data: { get(path: string): unknown },
  base: string | undefined,
) {
  if (typeof value === "string") return [{ id: value, base }];
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .map((id) => ({ id, base }));
  }
  if (value && typeof value === "object") {
    const { componentId, path } = value as {
      componentId?: unknown;
      path?: unknown;
    };
    if (typeof componentId === "string" && typeof path === "string") {
      const listPath = resolvePath(path, base);
      const list = data.get(listPath);
      // Every item: items can bind different children. At most 50, enough to see each type.
      return Array.isArray(list)
        ? list.slice(0, 50).map((_, index) => ({
            id: componentId,
            base: `${listPath}/${index}`,
          }))
        : [];
    }
    if (typeof componentId === "string") return [{ id: componentId, base }];
  }
  return [];
}

/**
 * The component types that render from "root": through slots and child
 * references, with bindings read from the data and templates expanded over
 * their items. A component nothing renders must not count.
 */
function reachableTypes(
  model: {
    get(
      id: string,
    ): { type: string; properties: Record<string, unknown> } | undefined;
  },
  ui: {
    components: ReadonlyMap<
      string,
      { slots?: unknown; childRefs: readonly ChildRef[] }
    >;
  },
  data: { get(path: string): unknown },
) {
  const types: string[] = [];
  let interactive = false;
  const seen = new Set<string>();
  const queue: Array<{ id: string; base: string | undefined }> = [
    { id: "root", base: undefined },
  ];
  while (queue.length > 0) {
    const { id, base } = queue.shift()!;
    const key = `${id}@${base ?? ""}`;
    if (seen.has(key) || seen.size > 2000) continue;
    seen.add(key);
    const found = model.get(id);
    if (!found) continue;
    if (!types.includes(found.type)) types.push(found.type);
    const definition = ui.components.get(found.type);
    if (!definition) continue;
    // A component with an event set (a List with an action) is a control, not prose.
    const events = Object.keys(
      (definition as { events?: unknown }).events ?? {},
    );
    if (events.some((event) => found.properties[event] !== undefined))
      interactive = true;
    const slots = Object.keys(
      (definition.slots as Record<string, unknown> | undefined) ?? {},
    );
    for (const slot of slots) {
      queue.push(
        ...childrenOf(
          resolveBound(found.properties[slot], data, base),
          data,
          base,
        ),
      );
    }
    const resolved = resolveBound(found.properties, data, base) as Record<
      string,
      unknown
    >;
    for (const ref of definition.childRefs) {
      // childIdsAtRefs gives the ids; templates at a ref are expanded here.
      const at = ref.path.reduce<unknown>(
        (value, k) =>
          value && typeof value === "object" && k !== "*"
            ? (value as Record<string, unknown>)[k]
            : value,
        resolved,
      );
      if (ref.path.includes("*")) {
        for (const childId of childIdsAtRefs(resolved, [ref]))
          queue.push({ id: childId, base });
      } else {
        queue.push(...childrenOf(at, data, base));
      }
    }
  }
  return { types, interactive };
}

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
const [engine, { GenerativeUIRuntimeContext }, { SurfaceView }, resolveModule] =
  await Promise.all([
    import("./engine"),
    import("../../../packages/react-core/src/v2/generative-ui/runtime-context"),
    import("../../../packages/react-core/src/v2/generative-ui/SurfaceView"),
    import("../../../packages/react-core/src/v2/generative-ui/resolve"),
  ]).catch((error: unknown) => {
    parentPort?.postMessage({
      fatal: String((error as Error)?.stack ?? error),
    });
    throw error;
  });
resolveDynamic = resolveModule.tryResolveDynamicValue;

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
    const deletedOnPurpose = (
      content.operations as Array<Record<string, any>>
    ).some((op) => op.deleteSurface?.surfaceId === content.surfaceId);
    if (!surface && deletedOnPurpose) {
      results.push({
        surfaceId: content.surfaceId,
        rendered: true,
        errors: [],
        rejected,
        components: [],
        proseOnly: false,
        deleted: true,
      });
      continue;
    }
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
    const reach = reachableTypes(
      surface.model.componentsModel,
      ui,
      surface.model.dataModel,
    );
    const components = reach.types;
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
        !reach.interactive &&
        components.length > 0 &&
        components.every((c) => TEXT_COMPONENTS.has(c)),
      crash,
    });
    await act(async () => root.unmount());
    container.remove();
  }
  return results;
}

// One request at a time: React's act() scopes must not overlap, or a
// render may not flush before the check reads the page.
let queue = Promise.resolve();
parentPort?.on("message", (request: RenderRequest) => {
  queue = queue.then(async () => {
    let result: RenderResult;
    try {
      result = { id: request.id, surfaces: await check(request.surfaces) };
    } catch (error) {
      result = {
        id: request.id,
        surfaces: [],
        error: (error as Error).message,
      };
    }
    parentPort?.postMessage(result);
  });
});
parentPort?.postMessage({ ready: true });
