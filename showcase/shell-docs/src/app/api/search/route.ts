import { inReaderScope, liveSearch } from "@/lib/llms/live-search";
import { scopeFromPath } from "@/lib/live-scope";

// The sidebar search dialog's endpoint (Fumadocs' fetch client calls
// `/api/search?query=`): the live docs and the API reference. The dialog
// (`src/components/search/docs-search-dialog.tsx`) adds `scope`, the URL
// prefix of the page the reader searches from. Results are the pages the
// reader's frontend has (each index entry is tagged with its frontends), and
// open in that scope.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "";
  const { frontend } = scopeFromPath(scope.split("/").filter(Boolean));
  url.searchParams.set("tag", frontend);
  const response = await liveSearch.GET(new Request(url, request));
  if (!scope || !response.ok) return response;
  return Response.json(inReaderScope(await response.json(), scope));
}
