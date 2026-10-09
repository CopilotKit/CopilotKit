import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Atai's trajectory view (CopilotKitCommonAgentWorkspace 9c9dc16b), served as-is
 * with its data layer swapped: `adapter.js` reads /api/learning/v1 and builds
 * the page's EVENTS. `/intelligence/trajectories/[id]` embeds it inside the
 * Intelligence shell with `?embed=1`, which hides only the page's own sidebar,
 * breadcrumb bar, background and prototype badge. See
 * src/intelligence-ui/trajectory-view/SOURCE.md.
 */
const DIR = path.join(process.cwd(), "src/intelligence-ui/trajectory-view");

/** Embedded inside the Intelligence shell: drop the page's own chrome, report its height. */
const EMBED = `<base target="_top">
<style>
  .ambient, .sidebar, .crumbs { display: none !important; }
  .app { display: block !important; padding: 0 !important; min-height: 0 !important; }
  .main { padding-top: 0 !important; }
  .head { margin-top: 0 !important; }
  html, body { background: transparent !important; }
</style>
<script>
  (function () {
    function post() {
      parent.postMessage({ type: "intelligence-trajectory-height", height: document.documentElement.scrollHeight }, location.origin);
    }
    // "Show event" opens a group, which grows the page; once it has, ask the shell to
    // bring the flashed event into view (the shell, not this frame, does the scrolling).
    document.addEventListener("click", function (event) {
      if (!event.target.closest || !event.target.closest("[data-jump]")) return;
      setTimeout(function () {
        post();
        var el = document.querySelector(".flash");
        if (el) parent.postMessage({ type: "intelligence-trajectory-scroll", top: el.getBoundingClientRect().top + scrollY }, location.origin);
      }, 350);
    }, true);
    addEventListener("load", function () {
      post();
      new ResizeObserver(post).observe(document.body);
    });
  })();
</script>
`;

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const embed = new URL(request.url).searchParams.get("embed") === "1";
  const [page, adapter] = await Promise.all([
    readFile(path.join(DIR, "index.html"), "utf8"),
    readFile(path.join(DIR, "adapter.js"), "utf8"),
  ]);
  // The id is embedded as JSON inside a script; escape "<" so it cannot close the tag.
  const boot = `<script>window.__TRAJECTORY_ID__ = ${JSON.stringify(decodeURIComponent(id)).replace(/</g, "\\u003c")};</script>\n<script>${adapter}</script>\n`;
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${boot}${embed ? EMBED : ""}</head>\n<body>\n${page}\n</body>\n</html>\n`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
