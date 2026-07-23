import type { EnrichmentResult } from "@/lib/crm";

export function AccountResearch({
  enrichment,
  accountName,
}: {
  enrichment?: EnrichmentResult;
  accountName: string;
}) {
  if (!enrichment || typeof enrichment.summary !== "string") {
    return (
      <p className="text-sm text-muted-foreground">
        No research yet — ask the assistant to research {accountName}.
      </p>
    );
  }
  const talkingPoints = enrichment.talkingPoints ?? [];
  const recentNews = enrichment.recentNews ?? [];
  return (
    <div className="space-y-3 text-sm">
      <p className="text-foreground/90">{enrichment.summary}</p>
      {talkingPoints.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Talking points
          </div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {talkingPoints.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {recentNews.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Recent news
          </div>
          <ul className="mt-1 space-y-0.5">
            {recentNews.map((n, i) => (
              <li key={i}>
                <a
                  className="text-primary hover:underline"
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {n.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
