import { describe, expect, it } from "vitest";
import {
  getAngularDocsNavTree,
  resolveAngularDoc,
} from "../angular-doc-navigation";
import { getDocsMode, getIntegrations } from "../registry";

type NavNode = ReturnType<typeof getAngularDocsNavTree>[number];

function pageSlugs(nodes: NavNode[]): string[] {
  return nodes.flatMap((node): string[] => {
    if (node.type === "page") return [node.slug];
    if (node.type === "group") return pageSlugs(node.children ?? []);
    return [];
  });
}

// `content/docs/frontends/angular.mdx` is the Angular quickstart. It is
// backend-scoped: its runtime step follows the sidebar's backend selection.
// The backend quickstarts under `integrations/` are Next.js pages — they open
// with `npx create-next-app` and install `@copilotkit/react-core`.
const ANGULAR_QUICKSTART = "frontends/angular";

describe("the Angular sidebar's quickstart", () => {
  const backends = getIntegrations()
    .map((integration) => integration.slug)
    .filter((slug) => getDocsMode(slug) !== "hidden");

  it("has backends to check", () => {
    expect(backends.length).toBeGreaterThan(5);
    expect(
      backends.every((slug) => typeof slug === "string" && slug.length > 0),
    ).toBe(true);
  });

  it("never resolves to a backend's React quickstart", () => {
    for (const backend of backends) {
      const resolved = resolveAngularDoc(backend, "quickstart");
      expect(
        resolved?.contentSlugPath,
        `backend ${backend} sent an Angular reader to ${resolved?.contentSlugPath}`,
      ).toBe(ANGULAR_QUICKSTART);
    }
  });

  it("keeps the entry the sidebar advertises", () => {
    for (const backend of backends) {
      expect(
        pageSlugs(getAngularDocsNavTree(backend)),
        `backend ${backend} lost the quickstart entry`,
      ).toContain("quickstart");
    }
  });
});
