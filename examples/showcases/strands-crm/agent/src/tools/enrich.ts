import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { crm } from "../crm/store.js";
import { searchWeb } from "../tavily.js";
import type { EnrichmentResult } from "../crm/types.js";

export const searchWebTool = tool({
  name: "search_web",
  description:
    "Search the web with Tavily. Returns title/url/content hits. Prefer enrich_lead for account research.",
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number().min(1).max(10).optional(),
  }),
  callback: async ({ query, maxResults }) => {
    const hits = await searchWeb(query, maxResults ?? 5);
    return hits as unknown as JSONValue;
  },
});

export const enrichLeadTool = tool({
  name: "enrich_lead",
  description:
    "Research an account on the web (Tavily) and write structured enrichment (summary, size, recent news, talking points, sources) onto its CRM record.",
  inputSchema: z.object({
    accountId: z.string().optional(),
    name: z.string().optional(),
  }),
  callback: async ({ accountId, name }) => {
    const account = accountId
      ? crm.getAccount(accountId)
      : name
        ? crm.findAccountByName(name)
        : undefined;
    if (!account)
      throw new Error(`account not found: ${accountId ?? name ?? "(none)"}`);

    let hits: Awaited<ReturnType<typeof searchWeb>>;
    try {
      hits = await searchWeb(
        `${account.name} ${account.domain} company overview funding news`,
        5,
      );
    } catch (err) {
      // Web search unavailable (e.g. TAVILY_API_KEY not set). Degrade gracefully
      // to a valid EnrichmentResult so the UI renders a clear message instead of
      // receiving an error-shaped tool result it cannot render.
      const failed: EnrichmentResult = {
        summary: `Enrichment unavailable for ${account.name}: ${(err as Error).message}`,
        sizeEmployees: account.sizeEmployees,
        recentNews: [],
        talkingPoints: [],
        sources: [],
        enrichedAt: new Date().toISOString(),
      };
      crm.setEnrichment(account.id, failed);
      return failed as unknown as JSONValue;
    }

    const enrichment: EnrichmentResult = {
      summary:
        hits[0]?.content?.slice(0, 280) ??
        `No recent web results found for ${account.name}.`,
      sizeEmployees: account.sizeEmployees,
      recentNews: hits.slice(0, 3).map((h) => ({ title: h.title, url: h.url })),
      talkingPoints: hits.slice(0, 3).map((h) => `Reference: ${h.title}`),
      sources: hits.map((h) => ({ title: h.title, url: h.url })),
      enrichedAt: new Date().toISOString(),
    };

    crm.setEnrichment(account.id, enrichment);
    return enrichment as unknown as JSONValue;
  },
});
