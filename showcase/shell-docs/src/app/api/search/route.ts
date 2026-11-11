import {
  frameworkTag,
  inReaderScope,
  liveSearch,
} from "@/lib/llms/live-search";
import { scopeFromPath } from "@/lib/live-scope";

// The sidebar search dialog's endpoint (Fumadocs' fetch client calls
// `/api/search?query=`): the live docs and the API reference. The dialog
// (`src/components/search/docs-search-dialog.tsx`) adds `scope`, the URL
// prefix of the page the reader searches from. Each index entry is tagged
// with the frontends and frameworks whose readers have it, so results are the
// pages the reader's frontend has, plus their framework's own setup steps,
// and they open in that scope.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "";
  const { frontend, framework } = scopeFromPath(
    scope.split("/").filter(Boolean),
  );
  url.searchParams.set("tag", `${frontend},${frameworkTag(framework)}`);
  const response = await liveSearch.GET(new Request(url, request));
  if (!scope || !response.ok) return response;
  return Response.json(inReaderScope(await response.json(), scope));
}
