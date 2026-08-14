import { CellUnavailable } from "@/components/cell-unavailable";
import {
  getIntegration,
  resolveDemoSupport,
  listAllDemoIds,
} from "@/lib/integration-support";

export const dynamic = "force-dynamic";

export default async function IntegrationIndex({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration: slug } = await params;

  /**
   * Same guard, same reason as `demos/layout.tsx` and `demos/[demo]/page.tsx`:
   * `getIntegration` and `resolveDemoSupport` both read the manifest tree, and
   * both throw `ManifestLoadError` when it cannot be loaded (unset or wrong
   * `SHOWCASE_INTEGRATIONS_DIR`, malformed YAML, an image that staged nothing)
   * — the likeliest deployment misconfiguration there is.
   *
   * UNCAUGHT, that becomes Next's generic 500 HTML page ("Application error: a
   * server-side exception has occurred") and the actionable strings — the env
   * var name, the candidate paths, the cwd, the offending YAML file — are
   * discarded. `src/lib/demo-runtime.ts` returns the same fault as a readable
   * JSON body, so leaving this index unguarded made the operator-facing
   * message depend on which entry point you happened to open: `/mastra` said
   * nothing while `/mastra/demos/agentic-chat` said everything. Both calls sit
   * inside one `try` because either can raise the same fault.
   *
   * `src/app/page.tsx` is deliberately UNGUARDED and says so — do not copy this
   * guard there.
   */
  let manifest: ReturnType<typeof getIntegration>;
  let rows: {
    demoId: string;
    support: ReturnType<typeof resolveDemoSupport>;
  }[];
  try {
    manifest = getIntegration(slug);
    // The unified frontend serves the UNION of demos, so this index lists
    // every known demo id and marks the ones this backend cannot drive,
    // rather than hiding them. Hiding them would make a shell link that
    // points here look broken instead of explained.
    rows = manifest
      ? listAllDemoIds().map((demoId) => ({
          demoId,
          support: resolveDemoSupport(slug, demoId),
        }))
      : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[integration-index] failed to load the integration manifests for ${slug}:`,
      error,
    );
    return (
      <CellUnavailable
        support={{
          kind: "malformed",
          reason:
            `Showcase integration index could not load the integration manifests ` +
            `for ${slug}: ${message}`,
        }}
      />
    );
  }

  if (!manifest) {
    return (
      <CellUnavailable
        support={{
          kind: "malformed",
          reason: `Unknown Showcase integration ${JSON.stringify(slug)}.`,
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <main
        style={{
          maxWidth: "980px",
          margin: "0 auto",
          padding: "3rem 1.5rem 4rem",
        }}
      >
        <header
          style={{
            paddingBottom: "1.5rem",
            borderBottom: "1px solid var(--border)",
            marginBottom: "2rem",
          }}
        >
          <h1
            style={{
              fontSize: "2.25rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {manifest.name}
          </h1>
          <p
            style={{
              color: "var(--muted-foreground)",
              marginTop: "0.75rem",
              fontSize: "0.875rem",
            }}
          >
            {/*
              Informational rows are excluded from BOTH sides of the ratio, not
              just the numerator. They are not runnable cells at all (`cli-start`
              is a copy-paste CLI command), so counting them in the denominator
              would make every integration read as "N of M" with a permanent
              shortfall — a phantom regression rather than a real gap.
            */}
            {rows.filter((row) => row.support.kind === "supported").length} of{" "}
            {rows.filter((row) => row.support.kind !== "informational").length}{" "}
            runnable demos supported by this backend
            {rows.some((row) => row.support.kind === "informational")
              ? `, plus ${rows.filter((row) => row.support.kind === "informational").length} informational.`
              : "."}
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {rows.map(({ demoId, support }) => {
            // Three states, not two. Dimming an informational row and labelling
            // it "not supported" is the false claim this page used to make:
            // the integration DOES support the feature, it just has no runnable
            // surface. It gets its own label and full opacity.
            const informational = support.kind === "informational";
            const supported = support.kind === "supported";
            const label = informational
              ? "command"
              : supported
                ? "supported"
                : "not supported";
            return (
              <a
                key={demoId}
                href={`/${slug}/demos/${demoId}`}
                className="demo-card"
                style={
                  supported || informational ? undefined : { opacity: 0.55 }
                }
              >
                <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
                  {demoId}
                </div>
                <div
                  style={{
                    marginTop: "0.375rem",
                    fontSize: "0.75rem",
                    color: "var(--muted-foreground)",
                  }}
                >
                  {label}
                </div>
              </a>
            );
          })}
        </div>
      </main>
    </div>
  );
}
