// Pure source-rewrite pass for `<DemoCode>` references in a concept
// file. Lives in its own file (no JSX) so test code can import it
// without pulling the React component shim through the test graph.
// See setup-concept.tsx for the orchestrator that drives this pass.

import fs from "fs";
import path from "path";
import { extractRegion, inferLanguage } from "./demo-code";
import { resolveWithinDir } from "./safe-fs";

/**
 * Match the value of a string-literal JSX attribute. Returns undefined
 * for expression-valued attrs (e.g. `file={x}`) so the rewrite pass can
 * leave those references intact for the runtime component shim.
 */
function matchAttr(attrs: string, name: string): string | undefined {
  const dq = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  if (dq) return dq[1];
  const sq = new RegExp(`\\b${name}='([^']*)'`).exec(attrs);
  if (sq) return sq[1];
  return undefined;
}

/**
 * Pre-expand `<DemoCode file="..." region="..." [language="..."] [title="..."] />`
 * JSX references in a concept-file source into fenced markdown blocks
 * sourced from `packageRoot`. The rewritten fences flow through the
 * regular MDXRemote → rehypeCode pipeline so they pick up Shiki
 * highlighting + the MdxCodeBlock chrome (copy button + figcaption).
 *
 * Only string-literal props are handled here. References with
 * expression-valued props (e.g. `file={something}`) are left intact
 * for the runtime component shim to resolve. Same posture as
 * `inlineSnippets` in docs-render.tsx.
 *
 * A reference whose file or region can't be found is replaced with an
 * empty string (logged to the server console). The body shouldn't
 * silently surface a broken `<DemoCode>` JSX tag — that would crash
 * the MDX compile.
 */
export function rewriteDemoCode(source: string, packageRoot: string): string {
  // Match `<DemoCode ... />` with any attribute body. The lazy `[^>]*?`
  // gobble stops at the closing `/>`, which is right — we never want
  // to span past the end of the tag — but it MUST NOT exclude `/` or
  // we'd fail to match attribute values like `file="src/agents/foo.py"`.
  const RX = /<DemoCode\s+([^>]*?)\s*\/>/g;
  return source.replace(RX, (match, attrs: string) => {
    const file = matchAttr(attrs, "file");
    const region = matchAttr(attrs, "region");
    if (!file || !region) return match;

    const language = matchAttr(attrs, "language");
    const title = matchAttr(attrs, "title");

    const resolved = resolveWithinDir(packageRoot, file);
    if (!resolved || !fs.existsSync(resolved)) {
      console.warn(
        "[demo-code] file not found",
        file,
        "in package root",
        packageRoot,
      );
      return "";
    }
    let raw: string;
    try {
      raw = fs.readFileSync(resolved, "utf-8");
    } catch (err) {
      console.warn("[demo-code] failed to read", resolved, err);
      return "";
    }
    const ext = file.includes(".")
      ? file.slice(file.lastIndexOf(".") + 1).toLowerCase()
      : "";
    let body: string | null;
    try {
      body = extractRegion(raw, region, ext);
    } catch (err) {
      console.warn(
        "[demo-code] extraction failed",
        file,
        region,
        (err as Error).message,
      );
      return "";
    }
    if (body === null) {
      console.warn("[demo-code] region not found", region, "in", file);
      return "";
    }
    const lang = language ?? inferLanguage(file);
    const fenceTitle = title ?? path.basename(file);
    // 4-tilde fence so the embedded body can safely contain triple
    // backticks without prematurely closing the fence.
    return ["", `~~~${lang} title="${fenceTitle}"`, body, "~~~", ""].join("\n");
  });
}
