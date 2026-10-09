/**
 * THE LEDGERLINE MCP APP: the browser half of `ui://ledgerline/ledgerline-app.html`.
 *
 * Bundled by `scripts/build-ledgerline-mcp-app.mjs` into one self-contained
 * HTML file (React, the cards and their compiled Tailwind CSS inlined) and
 * served by `../mcp/server.ts`. A thin host adapter: the UI is the in-app
 * chat's own cards from `../genui/`, and the Review matches card confirms
 * through the app-only `confirmMatches` tool. It talks to its host
 * only through the MCP Apps bridge, so it needs no network.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ReportCard } from "../genui/cards";
import { ReviewMatchesCard } from "../genui/review-card";
import type { ReportCardView, ReviewOutcome, ReviewView } from "../genui/views";

const app = new App(
  { name: "Ledgerline", version: "1.0.0" },
  {},
  { autoResize: true },
);

type View = ReportCardView | ReviewView;

function textOf(result: CallToolResult): string {
  return (
    result.content
      ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n") ?? ""
  );
}

function viewOf(result: CallToolResult | null): View | null {
  const s = result?.structuredContent as { kind?: string } | undefined;
  return s?.kind === "report-card" || s?.kind === "review-card"
    ? (s as unknown as View)
    : null;
}

async function tellHost(text: string) {
  try {
    await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
  } catch (error) {
    console.error("[ledgerline-app] could not message the host", error);
  }
}

function Note({ text, bad }: { text: string; bad?: boolean }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-[0.8rem] ${bad ? "border-negative/30 bg-negative-soft" : "border-hairline bg-surface text-ink-muted"}`}
    >
      {text}
    </div>
  );
}

function Root() {
  const [result, setResult] = useState<CallToolResult | null>(null);
  const [outcome, setOutcome] = useState<ReviewOutcome | "edit" | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    app.ontoolresult = (r) => setResult(r as CallToolResult);
    app
      .connect()
      .catch((error: unknown) =>
        setBridgeError(error instanceof Error ? error.message : String(error)),
      );
  }, []);

  const repeat =
    (result?.structuredContent as { kind?: string } | undefined)?.kind ===
    "repeat";
  useEffect(() => {
    // A duplicate call (ChatGPT): draw nothing and ask the host to drop this frame.
    if (repeat) app.requestTeardown().catch(() => {});
  }, [repeat]);

  if (repeat) return null;
  if (bridgeError)
    return <Note bad text={`Could not reach the host: ${bridgeError}`} />;
  if (!result) return <Note text="Loading Ledgerline..." />;
  const view = viewOf(result);
  if (!view) return <Note bad={!!result.isError} text={textOf(result)} />;
  if (view.kind === "report-card") return <ReportCard report={view.report} />;
  return (
    <ReviewMatchesCard
      view={view}
      // A host replaying a confirmed card (Intelligence) hands its outcome in.
      outcome={outcome ?? view.outcome ?? null}
      confirm={async () => {
        const r = (await app.callServerTool({
          name: "confirmMatches",
          arguments: { sessionId: view.sessionId },
        })) as CallToolResult;
        const o = r.structuredContent as ReviewOutcome | undefined;
        if (o && typeof o.ok === "boolean") return o;
        return {
          ok: false,
          summary: textOf(r) || "The server did not answer.",
        };
      }}
      onSettle={async (o) => {
        setOutcome(o);
        await tellHost(
          o.ok
            ? `I confirmed the matches in the Ledgerline card. ${o.summary}`
            : `The Ledgerline card reported a problem. ${o.summary}`,
        );
      }}
      onEdit={() => {
        setOutcome("edit");
        void tellHost(
          "I want to edit the matches myself on Ledgerline's Card close board. Nothing was closed.",
        );
      }}
    />
  );
}

// No StrictMode: its double-run effect would connect the bridge twice.
createRoot(document.getElementById("root")!).render(
  <div className="theme-ledgerline ledgerline-app">
    <Root />
  </div>,
);
