"use client";

import React from "react";
import { CopilotChat, useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { BrowseResultsCard, type BrowseResult } from "./browse-results-card";
import { parseJsonResult } from "../_shared/parse-json-result";
import { useSuggestions } from "./suggestions";

interface BrowseWebResult {
  task?: string;
  mode?: "hackernews" | "page";
  url?: string;
  results?: BrowseResult[];
  text?: string;
  error?: string;
}

export function Chat() {
  // Per-tool renderer: browse_web → BrowseResultsCard. The card shows a
  // loading state while the local browser navigates, then the extracted
  // results (or an error banner if the local Chromium could not run).
  useRenderTool(
    {
      name: "browse_web",
      parameters: z.object({
        task: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<BrowseWebResult>(result);
        return (
          <BrowseResultsCard
            loading={loading}
            task={parameters?.task ?? parsed.task ?? ""}
            mode={parsed.mode}
            results={parsed.results ?? []}
            text={parsed.text}
            error={parsed.error}
          />
        );
      },
    },
    [],
  );

  useSuggestions();

  return <CopilotChat agentId="browser-use" className="h-full rounded-2xl" />;
}
