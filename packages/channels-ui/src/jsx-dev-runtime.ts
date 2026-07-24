import { createRequire } from "node:module";
export { jsx, jsxs, Fragment } from "./jsx-runtime.js";

// Dev-mode counterpart of jsx/jsxs: host tags (string type) delegate to react's
// dev runtime (image path); components/Fragment become ChannelNodes. See
// jsx-runtime.ts for why react is a lazily-resolved optional peer.
let reactDev: { jsxDEV: (...a: unknown[]) => unknown } | null | undefined;
function react() {
  if (reactDev === undefined) {
    try {
      reactDev = createRequire(import.meta.url)("react/jsx-dev-runtime");
    } catch {
      reactDev = null;
    }
  }
  if (!reactDev) {
    throw new Error(
      "Rendering host elements (e.g. <div>) in channel JSX requires `react` — " +
        "it is an optional peer dependency of @copilotkit/channels-ui used for the image-render path.",
    );
  }
  return reactDev;
}

export function jsxDEV(
  type: any,
  props: any,
  key?: any,
  isStaticChildren?: any,
  source?: any,
  self?: any,
) {
  if (typeof type === "string") {
    return react().jsxDEV(type, props, key, isStaticChildren, source, self);
  }
  return { type, props: props ?? {}, key };
}
