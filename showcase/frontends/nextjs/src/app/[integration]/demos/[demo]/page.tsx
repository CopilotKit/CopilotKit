import { CellUnavailable } from "@/components/cell-unavailable";
import { resolveDemoSupport } from "@/lib/integration-support";

/**
 * PLACEHOLDER catch-all for `/<integration>/demos/<demo>`.
 *
 * The slug comes FIRST, before `demos`, on purpose. That shape lets every
 * manifest keep `route: /demos/<id>` unchanged and carry the slug in
 * `backend_url`, so the shells, the docs bundler, and the harness probe
 * drivers keep working untouched. Do not reshape to
 * `/demos/<integration>/<demo>`.
 *
 * Real demo pages sit as STATIC segments beside this file
 * (`src/app/[integration]/demos/<demo>/page.tsx`). Next.js prefers a static
 * segment over `[demo]`, so this route now answers ONLY for a demo id that
 * a manifest declares but nobody has ported yet — still a real case, which
 * is why this file stays.
 *
 * THE PRIMARY (integration x demo) SUPPORT GUARD is not here any more. It
 * moved to `../layout.tsx`, the one node that wraps both the static segments
 * and this placeholder; keeping it here meant it ran for nothing once the
 * demos landed.
 *
 * THE `resolveDemoSupport` CALL BELOW IS STILL LOAD-BEARING. Do not delete it
 * as a redundant re-check. This page is the ONLY node that sees the real demo
 * id: it comes from `params`. The layout cannot — a layout at that path is
 * handed `[integration]` only — so it reads the id out of the `x-pathname`
 * request header, which is trustworthy only for paths `src/middleware.ts`
 * actually runs for. It ran for this request as of the matcher fix in
 * `src/middleware.ts`, and `layout.test.tsx` pins that; but the layout's
 * answer is only ever as good as that header, and THIS check does not depend
 * on it at all. An earlier version of this comment called the call
 * "belt-and-braces, not the guard: by the time this renders the layout has
 * already answered anything unsupported" — which was false for exactly the
 * requests the matcher skipped, where this call was the only thing answering.
 * `page.test.tsx` asserts it, so deleting it goes red.
 *
 * It never calls `notFound()`. A 404 here would break shell links and
 * force the D6 probes to expect 404 for specific cells, which would put
 * per-integration knowledge inside a shared probe (showcase/AGENTS.md,
 * iron rule 1).
 */
export const dynamic = "force-dynamic";

export default async function DemoPlaceholderPage({
  params,
}: {
  params: Promise<{ integration: string; demo: string }>;
}) {
  const { integration: slug, demo: demoId } = await params;

  /**
   * Same guard, same reason as `../layout.tsx`: `resolveDemoSupport` throws
   * `ManifestLoadError` when the manifest tree cannot be loaded (unset or wrong
   * `SHOWCASE_INTEGRATIONS_DIR`, malformed YAML, an image that staged nothing),
   * and uncaught that message is replaced by Next's generic 500 HTML page.
   * `src/lib/demo-runtime.ts` returns the same fault as a readable JSON body,
   * so leaving the page path unguarded made the operator-facing message depend
   * on which entry point you happened to hit. The layout normally answers first,
   * but this file must not depend on that to stay diagnosable.
   */
  let support: ReturnType<typeof resolveDemoSupport>;
  try {
    support = resolveDemoSupport(slug, demoId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[demo-placeholder] failed to resolve support for ${slug}/${demoId}:`,
      error,
    );
    return (
      <CellUnavailable
        support={{
          kind: "malformed",
          reason:
            `Showcase demo page could not load the integration manifests for ` +
            `${slug}/${demoId}: ${message}`,
        }}
      />
    );
  }

  if (support.kind !== "supported") {
    return <CellUnavailable support={support} />;
  }

  return (
    <section
      role="status"
      className="mx-auto mt-16 max-w-xl rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-6 text-[var(--foreground)]"
    >
      <h1 className="text-lg font-semibold">Demo not wired yet</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {support.integrationName} supports {support.demoName}, but this frontend
        does not carry the demo page yet.
      </p>
      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-[var(--muted-foreground)]">Cell</dt>
        <dd className="break-all font-mono">
          {support.slug}/{support.demoId}
        </dd>
        <dt className="text-[var(--muted-foreground)]">Backend</dt>
        <dd>{support.integrationName}</dd>
        <dt className="text-[var(--muted-foreground)]">Feature</dt>
        <dd>{support.demoName}</dd>
      </dl>
    </section>
  );
}
