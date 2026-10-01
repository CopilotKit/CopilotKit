import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The trajectory view is Atai's prototype page itself (CopilotKitCommonAgentWorkspace
 * 9c9dc16b), served as-is with its data layer swapped: `adapter.js` reads
 * /api/learning/v1 and builds the page's EVENTS. See
 * src/intelligence-ui/trajectory-view/SOURCE.md.
 */
const DIR = path.join(process.cwd(), "src/intelligence-ui/trajectory-view");

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [page, adapter] = await Promise.all([
    readFile(path.join(DIR, "index.html"), "utf8"),
    readFile(path.join(DIR, "adapter.js"), "utf8"),
  ]);
  // The id is embedded as JSON inside a script; escape "<" so it cannot close the tag.
  const boot = `<script>window.__TRAJECTORY_ID__ = ${JSON.stringify(decodeURIComponent(id)).replace(/</g, "\\u003c")};</script>\n<script>${adapter}</script>\n`;
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${boot}</head>\n<body>\n${page}\n</body>\n</html>\n`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
