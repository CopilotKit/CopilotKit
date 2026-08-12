import type { EnrichmentResult } from "../lib/crm";

export function EnrichmentCard({
  result,
  status,
}: {
  result?: EnrichmentResult;
  status: string;
}) {
  if (status !== "complete") {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Researching the account…
      </div>
    );
  }
  if (!result || typeof result.summary !== "string") {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Research isn’t available right now.
      </div>
    );
  }
  const talkingPoints = result.talkingPoints ?? [];
  const recentNews = result.recentNews ?? [];
  const sources = result.sources ?? [];
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
        Account research
      </div>
      <p className="text-foreground/90">{result.summary}</p>
      {talkingPoints.length > 0 && (
        <>
          <div className="mt-2 text-xs font-medium text-muted-foreground">
            Talking points
          </div>
          <ul className="list-disc pl-5 text-muted-foreground">
            {talkingPoints.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {recentNews.length > 0 && (
        <>
          <div className="mt-2 text-xs font-medium text-muted-foreground">
            Recent news
          </div>
          <ul className="space-y-0.5">
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
        </>
      )}
      {sources.length > 0 && (
        <>
          <div className="mt-2 text-xs font-medium text-muted-foreground">
            Sources
          </div>
          <ul className="space-y-0.5">
            {sources.map((s, i) => (
              <li key={i}>
                <a
                  className="text-primary hover:underline"
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
