import {
  frameworkTag,
  inReaderScope,
  liveSearch,
} from "@/lib/llms/live-search";
import { LIVE_FRAMEWORKS, scopeFromPath } from "@/lib/live-scope";
import type { FrontendId } from "@/proto/data";

// The sidebar search dialog's endpoint (Fumadocs' fetch client calls
// `/api/search?query=`): the live docs and the API reference. The dialog
// (`src/components/search/docs-search-dialog.tsx`) adds `scope`, the URL
// prefix of the page the reader searches from. Each index entry is tagged
// with the frontends and frameworks whose readers have it, so results are the
// pages the reader's frontend has, plus their framework's own setup steps,
// and they open in that scope.
//
// A query that names another frontend or framework ("angular", "mastra")
// searches that one's pages instead: the reader asked for it by name.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "";
  const query = url.searchParams.get("query") ?? "";
  const reader = scopeFromPath(scope.split("/").filter(Boolean));
  const frontend = namedFrontend(query) ?? reader.frontend;
  const framework = namedFramework(query) ?? reader.framework;
  url.searchParams.set("tag", `${frontend},${frameworkTag(framework)}`);
  const response = await liveSearch.GET(new Request(url, request));
  if (!scope || !response.ok) return response;
  return Response.json(inReaderScope(await response.json(), scope));
}

const FRONTEND_NAMES: [RegExp, FrontendId][] = [
  [/\bangular\b/i, "angular"],
  [/\bvue(?:\.?js)?\b/i, "vue"],
  [/\breact[\s-]*native\b|\bexpo\b/i, "react-native"],
  [/\bslack\b/i, "slack"],
  [/\b(?:ms |microsoft )?teams\b/i, "teams"],
];

/** The frontend a query names, if any. */
function namedFrontend(query: string): FrontendId | undefined {
  return FRONTEND_NAMES.find(([pattern]) => pattern.test(query))?.[1];
}

/** How many docs folders start with each word. */
const FOLDER_HEADS = new Map<string, number>();
for (const folder of new Set(
  Object.values(LIVE_FRAMEWORKS).map((f) => f.folder),
)) {
  const head = folder.split("-")[0];
  FOLDER_HEADS.set(head, (FOLDER_HEADS.get(head) ?? 0) + 1);
}

/**
 * The framework a query names, by its URL slug (`crewai-crews`), its words
 * (`crewai crews`), or its docs folder (`langgraph`, `aws-strands`). Longer
 * names win, so "langgraph typescript" is LangGraph TypeScript.
 */
function namedFramework(query: string): string | undefined {
  const text = ` ${query.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let best: { slug: string; length: number } | undefined;
  for (const [slug, { folder }] of Object.entries(LIVE_FRAMEWORKS)) {
    // A folder's first word too (`crewai`, `langgraph`), unless another
    // folder shares it (`claude-sdk-python`, `claude-sdk-typescript`).
    const head = folder.split("-")[0];
    const aliases = [slug, folder];
    if (FOLDER_HEADS.get(head) === 1) aliases.push(head);
    for (const alias of new Set(aliases)) {
      const words = alias.replace(/-/g, " ");
      if (text.includes(` ${words} `) && words.length > (best?.length ?? 0)) {
        best = { slug, length: words.length };
      }
    }
  }
  return best?.slug;
}
