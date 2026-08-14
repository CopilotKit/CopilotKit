import {
  listAllDemoIds,
  listIntegrations,
  resolveDemoSupport,
} from "@/lib/integration-support";

export const dynamic = "force-dynamic";

export default function Home() {
  const integrations = listIntegrations();

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
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--muted-foreground)",
              marginBottom: "0.5rem",
            }}
          >
            CopilotKit Showcase
          </div>
          <h1
            style={{
              fontSize: "2.25rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Next.js frontend
          </h1>
          <p
            style={{
              color: "var(--muted-foreground)",
              fontSize: "1rem",
              lineHeight: 1.6,
              marginTop: "0.75rem",
              maxWidth: "62ch",
            }}
          >
            One Next.js app that serves the union of every demo, for every
            integration. Pick an integration to see the demos it supports.
          </p>
        </header>

        {/*
          There is deliberately no empty-state branch here. `listIntegrations()`
          THROWS when no manifests resolve — naming every candidate path it tried
          and the cwd — so an empty list cannot reach this component. An empty
          state would have rendered a friendly page over a broken deployment,
          which is the failure mode the loud throw exists to prevent.
        */}
        {
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {integrations.map((integration) => {
              // Counted through resolveDemoSupport, NOT by subtracting
              // not_supported_features from features. The subtraction counts
              // `cli-start`, which every manifest lists under `features` and
              // which resolves as INFORMATIONAL — a copy-paste CLI command
              // with no runnable surface. `/<slug>` deliberately excludes
              // informational rows from both sides of its ratio, so the two
              // pages disagreed by exactly one for every integration: the card
              // here said "43 demos" where /mastra said "42 of 46 runnable".
              // One rule, one owner: whatever resolveDemoSupport calls
              // supported is what both pages count.
              const supported = listAllDemoIds().filter(
                (id) =>
                  resolveDemoSupport(integration.slug, id).kind === "supported",
              );
              return (
                <a
                  key={integration.slug}
                  href={`/${integration.slug}`}
                  className="demo-card"
                >
                  <h2
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      margin: "0 0 0.375rem",
                    }}
                  >
                    {integration.name}
                  </h2>
                  <div
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontSize: "0.75rem",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    {integration.slug} · {supported.length} demos
                  </div>
                </a>
              );
            })}
          </div>
        }
      </main>
    </div>
  );
}
