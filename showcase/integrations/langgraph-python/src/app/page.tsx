import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

type Demo = {
  id: string;
  name: string;
  description?: string;
  route?: string;
  command?: string;
  tags?: string[];
};

type Manifest = {
  name: string;
  slug: string;
  description?: string;
  demos: Demo[];
};

const TAG_ORDER = [
  "chat-ui",
  "interactivity",
  "generative-ui",
  "agent-capabilities",
  "agent-state",
  "multi-agent",
  "headless",
  "platform",
  "other",
];

const TAG_LABELS: Record<string, string> = {
  "chat-ui": "Chat UI",
  interactivity: "Interactivity",
  "generative-ui": "Generative UI",
  "agent-capabilities": "Agent Capabilities",
  "agent-state": "Agent State",
  "multi-agent": "Multi-Agent",
  headless: "Headless",
  platform: "Platform",
  other: "Other",
};

function loadManifest(): Manifest {
  const manifestPath = path.join(process.cwd(), "manifest.yaml");
  return parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
}

function groupByTag(demos: Demo[]): { tag: string; demos: Demo[] }[] {
  const map = new Map<string, Demo[]>();
  for (const demo of demos) {
    const tag = demo.tags?.[0] ?? "other";
    if (!map.has(tag)) map.set(tag, []);
    map.get(tag)!.push(demo);
  }
  const tags = Array.from(map.keys()).sort((a, b) => {
    const ai = TAG_ORDER.indexOf(a);
    const bi = TAG_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return tags.map((tag) => ({ tag, demos: map.get(tag)! }));
}

export default function Home() {
  const manifest = loadManifest();
  const runnable = (manifest.demos ?? []).filter((d) => d.route);
  const groups = groupByTag(runnable);

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
            {manifest.name}
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
            {manifest.description ??
              "Browse runnable demos for this integration."}
          </p>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginTop: "1rem",
              fontSize: "0.8125rem",
              color: "var(--muted-foreground)",
            }}
          >
            <span>
              <strong style={{ color: "var(--foreground)" }}>
                {runnable.length}
              </strong>{" "}
              demos
            </span>
            <span>·</span>
            <span>{groups.length} categories</span>
            <span>·</span>
            <span>
              integration{" "}
              <code
                style={{
                  background: "var(--muted)",
                  padding: "0.125rem 0.4rem",
                  borderRadius: "0.375rem",
                  fontSize: "0.8125rem",
                }}
              >
                {manifest.slug}
              </code>
            </span>
          </div>
        </header>

        {groups.map(({ tag, demos }) => (
          <section key={tag} style={{ marginBottom: "2.5rem" }}>
            <h2
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--muted-foreground)",
                margin: "0 0 0.875rem",
              }}
            >
              {TAG_LABELS[tag] ?? tag.replace(/-/g, " ")}
              <span
                style={{
                  marginLeft: "0.5rem",
                  fontWeight: 400,
                  color: "var(--muted-foreground)",
                  opacity: 0.6,
                }}
              >
                {demos.length}
              </span>
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {demos.map((demo) => (
                <a key={demo.id} href={demo.route} className="demo-card">
                  <h3
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      margin: "0 0 0.375rem",
                      color: "var(--foreground)",
                    }}
                  >
                    {demo.name}
                  </h3>
                  {demo.description && (
                    <p
                      style={{
                        fontSize: "0.8125rem",
                        lineHeight: 1.5,
                        color: "var(--muted-foreground)",
                        margin: 0,
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {demo.description}
                    </p>
                  )}
                  <div
                    style={{
                      marginTop: "0.75rem",
                      fontFamily: "ui-monospace, monospace",
                      fontSize: "0.75rem",
                      color: "var(--muted-foreground)",
                      opacity: 0.7,
                    }}
                  >
                    {demo.route}
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
