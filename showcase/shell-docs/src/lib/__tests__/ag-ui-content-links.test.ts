import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// The `ag-ui` content tree is vendored from ag-ui-protocol/ag-ui, where the
// docs are served at the site root (`docs.ag-ui.com/concepts/events`). Here the
// same pages live one level down (`/ag-ui/concepts/events`), so a root-relative
// link copied over verbatim 404s. These tests pin the two forms that break so a
// future re-vendor cannot silently reintroduce them.

const AG_UI_ROOT = join(process.cwd(), "src/content/ag-ui");

function markdownFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.name.endsWith(".mdx") ? [entryPath] : [];
  });
}

interface AuthoredLink {
  file: string;
  href: string;
}

function authoredLinks(): AuthoredLink[] {
  return markdownFiles(AG_UI_ROOT).flatMap((file) => {
    const body = readFileSync(file, "utf8");
    const matches = body.matchAll(/\]\((\/[^)\s]*)\)/g);
    return [...matches].map((match) => ({
      file: file.slice(process.cwd().length + 1),
      href: match[1] as string,
    }));
  });
}

function pagePath(href: string): string {
  const slug = href.replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "");
  return join(AG_UI_ROOT, `${slug}.mdx`);
}

describe("vendored ag-ui docs links", () => {
  test("root-relative links that name an ag-ui page carry the /ag-ui prefix", () => {
    const unprefixed = authoredLinks().filter(
      ({ href }) => !href.startsWith("/ag-ui") && existsSync(pagePath(href)),
    );

    expect(
      unprefixed.map(({ file, href }) => `${file}: ${href}`),
    ).toStrictEqual([]);
  });

  test("no links use the upstream /docs/ path prefix", () => {
    const upstreamDocsLinks = authoredLinks().filter(({ href }) =>
      href.startsWith("/docs/"),
    );

    expect(
      upstreamDocsLinks.map(({ file, href }) => `${file}: ${href}`),
    ).toStrictEqual([]);
  });
});
