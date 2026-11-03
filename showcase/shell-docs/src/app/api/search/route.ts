import { liveSearch } from "@/lib/llms/live-search";

// The sidebar search dialog's endpoint (Fumadocs' default client fetches
// `/api/search?query=`): the live docs and the API reference.
export const GET = liveSearch.GET;
