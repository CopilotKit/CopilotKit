import { inReaderScope, liveSearch } from "@/lib/llms/live-search";

// The sidebar search dialog's endpoint (Fumadocs' fetch client calls
// `/api/search?query=`): the live docs and the API reference. The dialog
// (`src/components/search/docs-search-dialog.tsx`) adds `scope`, the URL
// prefix of the page the reader searches from, so results open there.
export async function GET(request: Request) {
  const response = await liveSearch.GET(request);
  const scope = new URL(request.url).searchParams.get("scope");
  if (!scope || !response.ok) return response;
  return Response.json(inReaderScope(await response.json(), scope));
}
