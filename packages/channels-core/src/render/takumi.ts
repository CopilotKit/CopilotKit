import type { ReactElement } from "react";
import type { ResolvedRenderConfig } from "./config.js";

type ReactModule = typeof import("react");
type TakumiModule = typeof import("takumi-js");

// The converter builds elements from dynamically-typed nodes, so React's strict
// `createElement` overloads don't apply — use a loose alias.
type LooseCreateElement = (
  type: unknown,
  props: unknown,
  ...children: unknown[]
) => unknown;

/**
 * Load the optional peers `takumi-js` and `react` at call time.
 *
 * Apps reach this module through `@copilotkit/runtime/v2`, and app bundlers
 * follow every import they can see. `takumi-js` pulls a native `.node` binary
 * that Turbopack cannot place in a chunk, and an app without the peers
 * installed cannot resolve them at all. So both are loaded by package name
 * through a native `import()` the bundlers are told to skip: the server
 * resolves them from node_modules only when an image is actually rendered.
 * esbuild ignores those hints, but leaves an unresolvable `import()` with a
 * `.catch` for run time instead of failing the bundle, hence the `rethrow`.
 */
async function loadPeers(): Promise<[TakumiModule, ReactModule]> {
  try {
    return await Promise.all([
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ "takumi-js"
      ).catch(rethrow),
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ "react"
      ).catch(rethrow),
    ]);
  } catch (err) {
    // `react` and `takumi-js` are optional peers, so a plain native-only app
    // never installs them. Name both instead of surfacing a bare resolve error.
    const code = (err as { code?: unknown } | null)?.code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new Error(
        "JSX image rendering needs the optional peer dependencies `react` and `takumi-js`. Install them (for example `pnpm add react takumi-js`); if they are installed, make sure your deployment ships them with the server.",
        { cause: err },
      );
    }
    throw err;
  }
}

function rethrow(err: unknown): never {
  throw err;
}

// React tags elements with one of these symbols (pre-19 vs 19+).
const REACT_ELEMENT = Symbol.for("react.element");
const REACT_TRANSITIONAL = Symbol.for("react.transitional.element");

function isReactEl(
  v: unknown,
): v is { type: unknown; props: Record<string, unknown>; key?: unknown } {
  if (typeof v !== "object" || v === null || !("$$typeof" in v)) return false;
  const t = (v as { $$typeof: unknown }).$$typeof;
  return t === REACT_ELEMENT || t === REACT_TRANSITIONAL;
}

interface Node {
  type: string | ((p: Record<string, unknown>) => unknown) | symbol;
  props: Record<string, unknown>;
  key?: string | number;
}
function isNode(v: unknown): v is Node {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    "props" in v &&
    !("$$typeof" in v)
  );
}

function toChildren(children: unknown, react: ReactModule): unknown[] {
  if (children == null || children === false) return [];
  return (Array.isArray(children) ? children : [children]).map((child) =>
    toReact(child, react),
  );
}

/**
 * Materialize a channels JSX tree to real React elements for Takumi.
 *
 * Host and component nodes from the channels JSX runtime are converted here,
 * after native rendering has classified the root. Existing React elements are
 * rebuilt with converted children; channel component nodes are invoked, and
 * fragments and primitives preserve their shape.
 */
function toReact(node: unknown, react: ReactModule): unknown {
  const h = react.createElement as LooseCreateElement;
  if (node == null || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return node.map((child) => toReact(child, react));
  if (isReactEl(node)) {
    const { children, ...rest } = node.props ?? {};
    const key = node.key;
    return h(
      node.type,
      key != null ? { ...rest, key } : rest,
      ...toChildren(children, react),
    );
  }
  if (isNode(node)) {
    const { type, props, key } = node;
    if (typeof type === "function") {
      // Unbranded app component / chart: invoke it and convert what it renders.
      // Carry the node's key onto the result so mapped component nodes
      // (`items.map(i => <Meter key={i.id}/>)`) don't warn about missing keys.
      const out = toReact(type(props ?? {}), react);
      return key != null && isReactEl(out)
        ? react.cloneElement(out as ReactElement, { key })
        : out;
    }
    const { children, ...rest } = props ?? {};
    if (typeof type === "symbol") {
      // Fragment (channels' sentinel) → React fragment.
      return h(
        react.Fragment,
        key != null ? { key } : null,
        ...toChildren(children, react),
      );
    }
    // Host markup from the dependency-free channels JSX runtime.
    return h(
      type,
      key != null ? { ...rest, key } : rest,
      ...toChildren(children, react),
    );
  }
  return null;
}

/**
 * Render a channels JSX tree (or a React element) to a PNG with Takumi. `node`
 * has been classified as image content by `resolveArbitraryElement` (./detect).
 * We materialize it to React elements first (see {@link toReact}).
 */
export async function renderJsxToPng(
  node: unknown,
  cfg: ResolvedRenderConfig,
): Promise<Uint8Array> {
  const [{ render }, react] = await loadPeers();
  if ((cfg.fonts?.length ?? 0) === 0) {
    // Takumi ships only a Latin fallback; warn once so non-Latin text doesn't silently drop.
    warnNoFonts();
  }
  const png = await render(toReact(node, react) as never, {
    width: cfg.width,
    height: cfg.height,
    fonts: cfg.fonts as never,
    stylesheets: cfg.stylesheets,
    // Gate every remote fetch the rasterizer makes (`<img src>`, CSS `url()`,
    // emoji sheets). Channel JSX is often built from model/user data, so an
    // ungated fetcher inside your infra is an SSRF sink — see render/url-policy.
    images: { allowUrl: cfg.allowImageUrl },
  });
  return png as Uint8Array;
}

let warned = false;
function warnNoFonts(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[channel] render: no fonts configured — only Latin (Geist) glyphs will render. " +
      "Pass render.fonts on createChannel for your app font / non-Latin text.",
  );
}
