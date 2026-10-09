/**
 * Render Mermaid diagram source to a PNG, locally, in headless Chromium.
 * Mermaid is loaded from a CDN into our own browser; the diagram source
 * never leaves the host. Invalid Mermaid throws with the parser message so
 * the tool can hand the agent a clear error to repair.
 *
 * Two-stage to keep AI-authored content from executing scripts:
 *   1. A "render" page loads Mermaid and turns the DSL into a sanitized SVG
 *      *string* (securityLevel "strict"); Mermaid only parses its own DSL
 *      here, never arbitrary HTML.
 *   2. A "shot" page displays that SVG with a `script-src 'none'` CSP, so
 *      even a crafted SVG can't run a script, then we screenshot it.
 */
import { getBrowser } from "./browser.js";

const MERMAID_CDN =
  process.env["MERMAID_URL"] ??
  "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

export async function renderDiagram(code: string): Promise<Buffer> {
  const browser = await getBrowser();

  // ── Stage 1: DSL → sanitized SVG string ─────────────────────────────
  const renderPage = await browser.newPage();
  let svg: string;
  try {
    await renderPage.setContent("<!doctype html><html><body></body></html>");
    await renderPage.addScriptTag({ url: MERMAID_CDN });
    const result = await renderPage.evaluate(async (code) => {
      // @ts-expect-error mermaid is injected by the CDN script
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      try {
        // @ts-expect-error mermaid global
        const out = await mermaid.render("graph", code);
        return { svg: out.svg as string };
      } catch (e) {
        return { error: String((e as Error)?.message ?? e) };
      }
    }, code);
    if ("error" in result) {
      throw new Error(`Mermaid render failed: ${result.error}`);
    }
    svg = result.svg;
  } finally {
    await renderPage.close();
  }

  // ── Stage 2: display under a no-script CSP and screenshot ────────────
  const shotPage = await browser.newPage({
    viewport: { width: 1000, height: 800 },
    deviceScaleFactor: 2,
  });
  try {
    await shotPage.setContent(
      `<!doctype html><html><head>` +
        `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">` +
        `</head><body style="margin:0;padding:16px;background:#ffffff">` +
        `<div id="out">${svg}</div></body></html>`,
      { waitUntil: "load" },
    );
    const el = await shotPage.$("#out svg");
    if (!el) throw new Error("Mermaid produced no SVG");
    return (await el.screenshot({ type: "png" })) as Buffer;
  } finally {
    await shotPage.close();
  }
}
