import { render } from "takumi-js";
import type { ResolvedRenderConfig } from "./config.js";

/**
 * Render a React element to a PNG with Takumi. `node` is always a resolved
 * React element by the time it reaches here — `resolveArbitraryElement`
 * (in `./detect.ts`) has already classified it as arbitrary JSX before
 * `Thread.postImage` calls this.
 */
export async function renderJsxToPng(
  node: unknown,
  cfg: ResolvedRenderConfig,
): Promise<Uint8Array> {
  if ((cfg.fonts?.length ?? 0) === 0) {
    // Takumi ships only a Latin fallback; warn once so non-Latin text doesn't silently drop.
    warnNoFonts();
  }
  const png = await render(node as never, {
    width: cfg.width,
    height: cfg.height,
    fonts: cfg.fonts as never,
    stylesheets: cfg.stylesheets,
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
