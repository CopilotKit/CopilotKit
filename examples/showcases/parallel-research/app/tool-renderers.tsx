"use client";
import { useEffect, useState } from "react";
import { useAgent, useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { readSources } from "../lib/sources";

/** Show safe source links and distinguish completed, partial, unreadable and interrupted results. */
function SourceCard({
  label,
  complete,
  result,
}: {
  label: string;
  complete: boolean;
  result: unknown;
}) {
  const { agent } = useAgent();
  const [interrupted, setInterrupted] = useState(false);
  useEffect(() => {
    if (!complete && !agent.isRunning) setInterrupted(true);
  }, [complete, agent.isRunning]);
  const { sources, failed, recognized } = readSources(result);
  const message = complete
    ? failed
      ? sources.length
        ? `${label}: some results were unavailable`
        : `${label}: failed`
      : !recognized
        ? `${label}: the response could not be read`
        : sources.length
          ? `${label}: finished`
          : `${label}: no sources returned`
    : interrupted || !agent.isRunning
      ? `${label}: stopped before results arrived`
      : `${label}…`;
  return (
    <section className="sources" aria-label={label}>
      <p role="status">{message}</p>
      {complete && sources.length === 0 ? (
        <p>
          {failed
            ? "The tool failed before it returned any source links. Try again or check the answer for details."
            : "No source links were returned. Check the answer for any search or extraction limitation."}
        </p>
      ) : null}
      {sources.length ? (
        <ul>
          {sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Register source cards for Parallel search and extraction tool calls. */
export function ToolRenderers() {
  useRenderTool(
    {
      name: "web_search",
      parameters: z.object({
        objective: z.string(),
        search_queries: z.array(z.string()),
        client_model: z.string().nullish(),
        session_id: z.string().nullish(),
      }),
      render: ({ status, result }) => (
        <SourceCard
          label="Searching the web"
          complete={status === "complete"}
          result={result}
        />
      ),
    },
    [],
  );
  useRenderTool(
    {
      name: "web_fetch",
      parameters: z.object({
        urls: z.array(z.string()),
        objective: z.string().nullish(),
        search_queries: z.array(z.string()).nullish(),
        full_content: z.boolean().optional(),
        allow_live_fetch: z.boolean().optional(),
        client_model: z.string().nullish(),
        session_id: z.string().nullish(),
      }),
      render: ({ status, result }) => (
        <SourceCard
          label="Reading sources"
          complete={status === "complete"}
          result={result}
        />
      ),
    },
    [],
  );
  return null;
}
