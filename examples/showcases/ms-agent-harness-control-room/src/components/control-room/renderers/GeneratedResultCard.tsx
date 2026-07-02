"use client";

/**
 * Card rendered for the agent's final `generated_result_card` tool call.
 *
 * This is a *native* primitive (the agent's final output card), so it does
 * NOT show the live-wrapper badge. Markdown is rendered as plain
 * whitespace-preserved text on purpose: we don't want to pull in a markdown
 * dependency just for this showcase demo.
 */

interface GeneratedResultCardProps {
  args?: {
    title?: string;
    body_markdown?: string;
    status?: string;
  };
  status?: string;
  result?: {
    title: string;
    body_markdown: string;
    status: string;
    timestamp: string;
  };
}

export function GeneratedResultCard({
  args,
  status,
  result,
}: GeneratedResultCardProps) {
  const title = result?.title ?? args?.title ?? "Generated result";
  const body = result?.body_markdown ?? args?.body_markdown ?? "";
  const cardStatus = (
    result?.status ??
    args?.status ??
    "pending"
  ).toLowerCase();
  const timestamp = result?.timestamp;
  const showSpinner = status !== "complete" && !result;

  return (
    <div className="cr-tool-card">
      <header className="cr-tool-card__header">
        <h3 className="cr-tool-card__title">{title}</h3>
        <StatusPill status={cardStatus} />
      </header>
      <section className="cr-tool-card__section">
        <div className="cr-tool-card__label">
          Markdown source (rendered as plain text)
        </div>
        {showSpinner ? (
          <p
            className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
            style={{ fontFamily: "var(--cr-font-mono)" }}
          >
            Awaiting generated output…
          </p>
        ) : (
          <pre className="cr-pre max-h-[320px]">{body || "(empty body)"}</pre>
        )}
      </section>
      {timestamp && (
        <p
          className="text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Emitted at {timestamp}
        </p>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "success" ? "emerald" : status === "failure" ? "red" : "amber";
  return (
    <span className="cr-chip" data-tone={tone}>
      {status}
    </span>
  );
}
