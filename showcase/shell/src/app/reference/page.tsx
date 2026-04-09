import Link from "next/link";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const CONTENT_DIR = path.join(process.cwd(), "src/content/reference");

type RefItem = { slug: string; title: string; description?: string };

function loadItems(subdir: string): RefItem[] {
  const dir = path.join(CONTENT_DIR, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const { data } = matter(raw);
      return {
        slug: `${subdir}/${f.replace(/\.mdx$/, "")}`,
        title: (data.title as string) || f.replace(/\.mdx$/, ""),
        description: data.description as string | undefined,
      };
    });
}

export default function ReferencePage() {
  const components = loadItems("components");
  const hooks = loadItems("hooks");

  // Also load the index page frontmatter for the intro
  let intro = "";
  const indexPath = path.join(CONTENT_DIR, "index.mdx");
  if (fs.existsSync(indexPath)) {
    const { data } = matter(fs.readFileSync(indexPath, "utf-8"));
    intro =
      (data.description as string) ||
      "API Reference for the next-generation CopilotKit React API.";
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-bold text-[var(--text)] mb-2">
        API Reference
      </h1>
      <p className="text-[var(--text-muted)] text-sm mb-10">{intro}</p>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-[var(--text)] mb-4">
          UI Components
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {components.map((item) => (
            <Link
              key={item.slug}
              href={`/reference/${item.slug}`}
              className="block rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <div className="font-mono text-sm font-semibold text-[var(--accent)]">
                {"<"}
                {item.title}
                {" />"}
              </div>
              {item.description && (
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {item.description}
                </div>
              )}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--text)] mb-4">Hooks</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {hooks.map((item) => (
            <Link
              key={item.slug}
              href={`/reference/${item.slug}`}
              className="block rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] transition-colors"
            >
              <div className="font-mono text-sm font-semibold text-[var(--accent)]">
                {item.title}()
              </div>
              {item.description && (
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {item.description}
                </div>
              )}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
