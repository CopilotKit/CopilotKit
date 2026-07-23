import { tavily } from "@tavily/core";

export interface WebHit {
  title: string;
  url: string;
  content: string;
}

let _client: ReturnType<typeof tavily> | undefined;

function getClient(): ReturnType<typeof tavily> {
  if (!_client) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error(
        "TAVILY_API_KEY is not set — required for web search / lead enrichment.",
      );
    }
    _client = tavily({ apiKey });
  }
  return _client;
}

// Fixed enrichment hits for deterministic demo capture (Acme Corp, seed a1).
// Returned only when MOCK_TAVILY=1 so the EnrichmentCard renders identically
// every run with no live Tavily call / API key. enrich.ts transforms these the
// same way it transforms real hits (summary = hits[0].content, etc.).
const MOCK_ACME_HITS: WebHit[] = [
  {
    title: "Acme Corp to invest $40M in smart-factory automation",
    url: "https://example.com/acme-automation",
    content:
      "Acme Corp announced a $40M initiative to modernize its Columbus plants with AI-driven scheduling and predictive maintenance, targeting a 20% throughput gain by 2027.",
  },
  {
    title:
      "Acme promotes Dana Reyes to VP Operations to lead digital transformation",
    url: "https://example.com/acme-vp-ops",
    content:
      "Dana Reyes will lead the rollout of a unified operations platform across Acme's manufacturing sites, with budget sign-off from the CFO.",
  },
  {
    title: "Report: Acme among fastest-modernizing mid-market manufacturers",
    url: "https://example.com/acme-report",
    content:
      "A 2026 industry survey ranks Acme Corp in the top decile for operations-software adoption among manufacturers with 1,000-2,000 employees.",
  },
  {
    title: "Acme Corp Q1 update: margins up on operational efficiency",
    url: "https://example.com/acme-q1",
    content:
      "Acme reported improved gross margins driven by efficiency gains in logistics and scheduling.",
  },
  {
    title: "Acme Corp company profile",
    url: "https://acme.com/about",
    content:
      "Acme Corp is a Columbus, OH manufacturer with ~1,200 employees serving industrial and consumer segments.",
  },
];

export async function searchWeb(
  query: string,
  maxResults = 5,
): Promise<WebHit[]> {
  if (process.env.MOCK_TAVILY === "1")
    return MOCK_ACME_HITS.slice(0, maxResults);
  const res = await getClient().search(query, { maxResults });
  return (res.results ?? []).map(
    (r: { title: string; url: string; content: string }) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }),
  );
}
