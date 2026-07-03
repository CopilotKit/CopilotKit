import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import Link from "next/link";

type Demo = {
  id: string;
  name: string;
  description?: string;
  route?: string;
  tags?: string[];
};

type Manifest = {
  name: string;
  slug: string;
  description?: string;
  features?: string[];
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
  const raw = fs.readFileSync(path.join(process.cwd(), "manifest.yaml"), "utf8");
  return parse(raw) as Manifest;
}

// Group demos by their first tag; order demos within a tag by manifest.features
// (the curated first-impression arc), and order tags by TAG_ORDER.
function groupByTag(
  demos: Demo[],
  features: string[],
): { tag: string; demos: Demo[] }[] {
  const featureIndex = new Map(features.map((id, i) => [id, i]));
  const orderOf = (id: string) =>
    featureIndex.get(id) ?? Number.MAX_SAFE_INTEGER;

  const map = new Map<string, Demo[]>();
  for (const demo of demos) {
    const tag = demo.tags?.[0] ?? "other";
    if (!map.has(tag)) map.set(tag, []);
    map.get(tag)!.push(demo);
  }
  for (const list of map.values()) {
    list.sort((a, b) => orderOf(a.id) - orderOf(b.id));
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
  const groups = groupByTag(runnable, manifest.features ?? []);

  return (
    <main className="max-w-3xl mx-auto p-8">
      <div className="text-xs font-semibold tracking-wider uppercase text-[var(--muted-foreground)] mb-2">
        CopilotKit Showcase
      </div>
      <h1 className="text-3xl font-bold tracking-tight mb-3">{manifest.name}</h1>
      <p className="text-[var(--muted-foreground)] leading-relaxed mb-6 max-w-[62ch]">
        {manifest.description ??
          "Browse runnable demos for this integration."}
      </p>
      <div className="text-sm text-[var(--muted-foreground)] mb-8">
        <strong className="text-[var(--foreground)]">{runnable.length}</strong>{" "}
        demos · {groups.length} categories · integration{" "}
        <code className="bg-[var(--muted)] px-1.5 py-0.5 rounded text-xs">
          {manifest.slug}
        </code>
      </div>

      {groups.map(({ tag, demos }) => (
        <section key={tag} className="mb-10">
          <h2 className="text-xs font-semibold tracking-wider uppercase text-[var(--muted-foreground)] mb-3">
            {TAG_LABELS[tag] ?? tag.replace(/-/g, " ")}
            <span className="ml-2 font-normal opacity-60">{demos.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {demos.map((demo) => (
              <Link
                key={demo.id}
                href={demo.route!}
                className="block rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 no-underline transition-colors hover:border-[var(--ring)]"
              >
                <h3 className="text-base font-semibold mb-1 text-[var(--foreground)]">
                  {demo.name}
                </h3>
                {demo.description && (
                  <p className="text-sm leading-snug text-[var(--muted-foreground)] m-0 line-clamp-3">
                    {demo.description}
                  </p>
                )}
                <div className="mt-3 font-mono text-xs text-[var(--muted-foreground)] opacity-70">
                  {demo.route}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
