import { headers } from "next/headers";

import { CellUnavailable } from "@/components/cell-unavailable";
import {
  classifyDemoPathname,
  resolveDemoSupport,
} from "@/lib/integration-support";
import { PATHNAME_HEADER } from "@/middleware";

/**
 * THE support guard for `/<integration>/demos/<demo>`.
 *
 * WHY IT LIVES IN A LAYOUT. The guard used to live in the dynamic
 * placeholder `[demo]/page.tsx`. That worked only while no demo had been
 * ported. All 43 demos now sit beside the placeholder as STATIC segments
 * (`demos/agentic-chat/page.tsx`, ...), and Next.js prefers a static
 * segment over `[demo]` — so the placeholder answered for nothing and the
 * guard silently stopped running. Measured live before this layout existed:
 * `/spring-ai/demos/gen-ui-interrupt` returned 200 and rendered the demo
 * even though spring-ai lists it under `not_supported_features`, and
 * `/nope/demos/agentic-chat` returned 200 for an integration that does not
 * exist. The build was green and every unit test passed.
 *
 * A layout is the only node that wraps BOTH the static segments and the
 * dynamic placeholder, and it keeps working for demos ported in the future
 * with no edit here. Putting the check back into pages would mean touching
 * all 43 demo folders and re-touching every one added later — 43 chances to
 * forget, against one node that cannot be forgotten.
 *
 * That is the whole argument. An earlier version of this comment also
 * claimed the folders "must not be edited (showcase/AGENTS.md)" and are
 * copied VERBATIM from upstream. Both are false: AGENTS.md has no such
 * rule (its four iron rules cover shared probes, near-identical frontends,
 * minimal backends and fixture-only variation), and the ported pages are
 * NOT verbatim — each carries hand-edits for this app, typically
 * `useParams`, a rewritten `runtimeUrl` and a corrected agent id. The
 * design still holds on the 43-vs-1 count alone; it never needed a rule
 * that does not exist.
 *
 * HOW IT LEARNS THE DEMO ID. A layout at this path is handed `params` for
 * `[integration]` only; the demo id is a child segment and Next.js 15 has
 * no API that passes it up (`unstable_rootParams` gives root params, not
 * child segments). So `src/middleware.ts` copies the request pathname into
 * an `x-pathname` request header and this layout parses it — the same
 * pattern the four showcase integrations that ship a middleware already use
 * (langgraph-fastapi, langgraph-python, langgraph-typescript,
 * ms-agent-dotnet; the other 16 ship none, so there was nothing to copy from
 * them).
 *
 * It never calls `notFound()`. A 404 would break shell links and force the
 * D6 probes to know, per integration, which cells 404 — per-integration
 * knowledge inside a shared probe is what showcase/AGENTS.md iron rule 1
 * forbids.
 *
 * KNOWN LIMIT: on a client-side soft navigation between two demos, Next
 * reuses this layout segment (its own params did not change) and the guard
 * does not re-run. Nothing in this app soft-navigates to a demo — the
 * integration index uses plain `<a href>` and the shells set an iframe
 * `src`, both full document loads. `layout.test.tsx` ASSERTS that (no
 * `next/link` navigation in `src/` targets a demo route), because a comment
 * is not a guard: one `<Link href="/spring-ai/demos/...">` reopens the
 * 200-renders-an-unsupported-demo regression. If you must add one, move the
 * check into the demo page itself first.
 */
export const dynamic = "force-dynamic";

export default async function DemosLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ integration: string }>;
}) {
  const { integration: slug } = await params;
  const pathname = (await headers()).get(PATHNAME_HEADER);

  // Fail LOUD. A missing OR blank header means `src/middleware.ts` did not
  // run, and the guard cannot know which demo was asked for. An empty string
  // is not `null`, so it has to be rejected explicitly — otherwise it falls
  // through and renders `children` unguarded, the exact silent-pass
  // regression this layout exists to close.
  if (pathname === null || pathname.trim() === "") {
    return (
      <CellUnavailable
        support={{
          kind: "malformed",
          reason:
            "Showcase support guard could not read the request path: the " +
            `\`${PATHNAME_HEADER}\` header is ` +
            (pathname === null ? "missing" : "empty") +
            ", so `src/middleware.ts` did not run for this request.",
        }}
      />
    );
  }

  const route = classifyDemoPathname(pathname, slug);

  // The ONLY pass-through: `/<slug>/demos`, the integration index. Every
  // other shape the guard cannot explain is reported, never waved past.
  if (route.kind === "demos-index") return <>{children}</>;

  if (route.kind === "malformed") {
    return (
      <CellUnavailable support={{ kind: "malformed", reason: route.reason }} />
    );
  }

  /**
   * `resolveDemoSupport` reads the manifest tree, which throws
   * `ManifestLoadError` for an unset or wrong `SHOWCASE_INTEGRATIONS_DIR`,
   * malformed YAML, or an image that staged nothing — the likeliest deployment
   * misconfiguration there is.
   *
   * UNCAUGHT, that becomes Next's generic 500 HTML page: "Application error: a
   * server-side exception has occurred", and the longest, most actionable
   * strings in this codebase — the env var name, the candidate paths, the cwd,
   * the offending YAML file — are discarded. `src/lib/demo-runtime.ts` catches
   * the same fault deliberately and returns it as a clean JSON body, so the API
   * path for one misconfiguration was diagnosable while the page path for the
   * SAME fault was not. Render it instead.
   */
  let support: ReturnType<typeof resolveDemoSupport>;
  try {
    support = resolveDemoSupport(slug, route.demoId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[demos-layout] failed to resolve support for ${slug}/${route.demoId}:`,
      error,
    );
    return (
      <CellUnavailable
        support={{
          kind: "malformed",
          reason:
            `Showcase support guard could not load the integration manifests for ` +
            `${slug}/${route.demoId}: ${message}`,
        }}
      />
    );
  }

  if (support.kind !== "supported") {
    return <CellUnavailable support={support} />;
  }

  return <>{children}</>;
}
