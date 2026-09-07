"use client";

import { useCallback } from "react";
import Image from "next/image";
import {
  CopilotChatView,
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { PaintFrame, PaintSurface } from "@/components/paint/PaintFrame";
import Summary from "@/components/Summary";
import SentimentSplit from "@/components/SentimentSplit";
import ArgumentMap from "@/components/ArgumentMap";
import ReceiptsTable from "@/components/ReceiptsTable";
import { panelStore, toReport, usePanels } from "@/lib/panel-store";
import type { PanelId } from "@/lib/panel-store";

const SUGGESTIONS = [
  "what is X saying about grok 4.6?",
  "what do people think of AG-UI?",
  "is anyone shipping with generative UI?",
];

/**
 * One line in the run log.
 *
 * Each tool call renders its own chip, so they can't share a wrapper. The left
 * rail is drawn per-chip instead: consecutive chips butt together and their
 * borders form one continuous line, which reads as a single sequence rather
 * than a scatter of loose bullets.
 */
function ToolChip({ label, status }: { label: string; status: string }) {
  const done = status === "complete";
  return (
    <div className="tool-chip">
      <span
        className={done ? "tool-dot" : "tool-dot live"}
        style={{ background: done ? "var(--agent)" : "var(--orange)" }}
      />
      <span className="mono">{label}</span>
    </div>
  );
}

const LABEL: Record<PanelId, string> = {
  summary: "Summary",
  sentiment: "SentimentSplit",
  arguments: "ArgumentMap",
  receipts: "PostFeed",
};

export default function Page() {
  const panels = usePanels();
  // Subscribing to both keeps `agent.messages` / `agent.isRunning` live, which
  // is what the headless CopilotChatView renders from.
  const { agent } = useAgent({
    updates: [
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });
  const { copilotkit } = useCopilotKit();

  // The search, as a FRONTEND tool. Uniform with the render tools so all five
  // reach the model through the same path.
  useFrontendTool({
    name: "searchX",
    description:
      "Search X for the live discourse on a topic. Returns a summary, the " +
      "sentiment split, the strongest arguments for and against, and the posts " +
      "backing them. Call once per new topic, before rendering.",
    parameters: z.object({
      topic: z.string().describe("what to search X for, e.g. 'grok 4.6'"),
    }),
    handler: async ({ topic }) => {
      panelStore.beginSearch();
      const res = await fetch("/api/x-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      if (!res.ok) throw new Error(`x-search failed: ${res.status}`);
      return res.json();
    },
    // xAI's server-side tool is "X Search" (`x_search`) — searches X posts, user
    // profiles and threads. Naming the chip after it, rather than after our
    // wrapper, keeps the chip honest about what is actually running.
    render: ({ status }) => (
      <ToolChip label="X Search · x_search" status={status} />
    ),
  });

  useFrontendTool({
    name: "renderSummary",
    description:
      "Render your read on the discourse at the top of the dashboard. Say what " +
      "the consensus is and where it breaks. Call this first, before the charts.",
    parameters: z.object({
      summary: z.string().describe("2-3 sentences, no hedging"),
      postsScanned: z.number(),
      window: z.string().describe("e.g. 'last 24 hours'"),
    }),
    handler: async ({ summary, postsScanned, window }) => {
      panelStore.setMeta(postsScanned, window);
      panelStore.setSummary(summary);
      return "rendered";
    },
    render: ({ status }) => <ToolChip label="renderSummary" status={status} />,
  });

  useFrontendTool({
    name: "renderSentimentSplit",
    description: "Render the positive/critical split for the topic.",
    parameters: z.object({
      bull: z.number().describe("percent positive, 0-100"),
      bear: z.number().describe("percent critical, 0-100"),
    }),
    handler: async ({ bull, bear }) => {
      panelStore.setSentiment(bull, bear);
      return "rendered";
    },
    render: ({ status }) => (
      <ToolChip label="renderSentimentSplit" status={status} />
    ),
  });

  useFrontendTool({
    name: "renderArgumentMap",
    description:
      "Render the bull and bear arguments. Pass every argument you want shown — " +
      "this replaces whatever is currently on screen.",
    parameters: z.object({
      arguments: z.array(
        z.object({
          stance: z.enum(["bull", "bear"]),
          claim: z.string(),
          support: z.number().describe("how many posts made this argument"),
        }),
      ),
    }),
    handler: async ({ arguments: args }) => {
      panelStore.setArguments(args.map((a) => ({ ...a, evidence: [] })));
      return "rendered";
    },
    render: ({ status }) => (
      <ToolChip label="renderArgumentMap" status={status} />
    ),
  });

  useFrontendTool({
    name: "renderReceipts",
    description:
      "Render the real posts backing the analysis, as X cards. Pass every post " +
      "you want shown — this replaces whatever is currently on screen.",
    parameters: z.object({
      posts: z.array(
        z.object({
          handle: z.string(),
          name: z.string(),
          text: z.string(),
          stance: z.enum(["bull", "bear", "neutral"]),
          likes: z.number(),
          replies: z.number().optional(),
          reposts: z.number().optional(),
          views: z.string(),
          postedAt: z.string(),
          verified: z.boolean().optional(),
          url: z
            .string()
            .optional()
            .describe("permalink to the post, if known"),
        }),
      ),
    }),
    handler: async ({ posts }) => {
      panelStore.setPosts(
        posts.map((p, i) => ({
          ...p,
          id: `p${i}`,
          url: p.url?.includes("/status/")
            ? p.url
            : `https://x.com/${p.handle}`,
        })),
      );
      return "rendered";
    },
    render: ({ status }) => <ToolChip label="renderReceipts" status={status} />,
  });

  /**
   * Runs MUST go through `copilotkit.runAgent`, not `agent.runAgent()`.
   *
   * The raw AG-UI method runs the agent WITHOUT the tools registered by
   * `useFrontendTool` — the model is handed an empty toolset and answers
   * "searchX is unavailable" instead of rendering. The core method attaches
   * them. Both entry points below go through here for that reason.
   */
  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q) return;
      // Clears the previous answer and marks the run as in flight. The canvas
      // stays closed until real panels arrive — see `docked` below.
      panelStore.beginSearch();
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: q });
      await copilotkit.runAgent({ agent });
    },
    [agent, copilotkit],
  );

  const report = toReport(panels, "");

  /**
   * Three states, and the middle one is the reason this is derived rather than
   * stored:
   *
   *   idle      — hero, composer, suggestions. Canvas closed.
   *   searching — hero collapses, the transcript takes its place so the run is
   *               visible (thinking, then the searchX chip). Canvas still
   *               CLOSED. An earlier version opened it here and parked four
   *               empty wireframes on screen for the ~60s the search takes;
   *               they read as a broken layout, not as anticipation.
   *   docked    — the first real panel has landed. Canvas opens, chat moves to
   *               the rail, and panels paint in as each render tool lands.
   */
  const docked = panels.order.length > 0;
  const searching = panels.pending && !docked;
  const busy = searching || docked;

  /** Panel body by id, so the pending and settled passes stay in sync. */
  const renderPanel = (id: PanelId) => {
    if (id === "summary") return <Summary report={report} />;
    if (id === "sentiment") return <SentimentSplit report={report} />;
    if (id === "arguments") return <ArgumentMap report={report} />;
    return <ReceiptsTable report={report} />;
  };

  /**
   * The canvas puts the summary across the top, then splits: analysis on the
   * left, the real post feed on the right at full width so the posts read as
   * posts rather than as a truncated list.
   */
  const canvas = (ids: PanelId[]) => {
    const left = ids.filter(
      (id) => id === "summary" || id === "sentiment" || id === "arguments",
    );
    const right = ids.filter((id) => id === "receipts");

    const frame = (id: PanelId) => (
      <PaintFrame
        key={id}
        component={LABEL[id]}
        id={id}
        ghostRender
        showLabel={false}
      >
        <div
          className="panel"
          style={
            id === "receipts"
              ? {
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  height: "100%",
                }
              : undefined
          }
        >
          {renderPanel(id)}
        </div>
      </PaintFrame>
    );

    return (
      <PaintSurface
        theme="none"
        staggerStep={200}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 0.92fr)",
          gap: 12,
          height: "100%",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {left.map((id) => frame(id))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {right.map((id) => frame(id))}
        </div>
      </PaintSurface>
    );
  };

  return (
    <CopilotChatView
      messages={agent.messages}
      isRunning={agent.isRunning}
      /**
       * Both of these are load-bearing.
       *
       * `welcomeScreen={false}`: with zero messages CopilotChatView returns its
       * own welcome layout EARLY, before it ever reads the children render prop
       * — so the composed layout below is silently discarded until the first
       * message. Disabling it lets every state flow through `children`.
       *
       * `input={{ showDisclaimer: false }}`: an object slot is merged OVER the
       * bound props, so this turns off the "AI can make mistakes" line the
       * input renders under itself — chrome from another app once the composer
       * is the page's own input. (Passing `disclaimer=""` does not work; the
       * input falls back to the default label on an empty string.)
       */
      welcomeScreen={false}
      input={{ showDisclaimer: false }}
      onSubmitMessage={ask}
    >
      {({ scrollView, input }) => (
        <main
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            height: "100vh",
            padding: 14,
          }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexShrink: 0,
            }}
          >
            <Image
              src="/copilotkit-logo-dark.svg"
              alt="CopilotKit"
              width={116}
              height={22}
              priority
            />
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              × grok-4.6
            </span>

            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <span
                className="pill"
                style={{ color: "var(--orange)", borderColor: "var(--orange)" }}
              >
                X Search · server-side
              </span>
              <span
                className="pill"
                style={{ color: "var(--agent)", borderColor: "var(--agent)" }}
              >
                frontend tools
              </span>
            </span>
          </header>

          <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14 }}>
            {/* Canvas — zero-width until the agent has something to show. */}
            <section
              style={{
                flex: docked ? 1 : "0 0 0px",
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
                opacity: docked ? 1 : 0,
                transition: "opacity 320ms ease 120ms",
              }}
            >
              {docked ? canvas(panels.order) : null}
            </section>

            {/*
              The chat. Its slots are composed into this layout rather than
              dropped in as a block, so the composer is the page's own input
              when centered and the rail's input when docked — one mounted
              view either way.
            */}
            <aside
              className={docked ? "chat-rail" : undefined}
              style={{
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                width: docked ? 336 : "100%",
                maxWidth: docked ? 336 : 900,
                marginInline: docked ? 0 : "auto",
                paddingLeft: docked ? 14 : 0,
                minHeight: 0,
                transition:
                  "width 480ms cubic-bezier(0.22, 1, 0.36, 1), max-width 480ms cubic-bezier(0.22, 1, 0.36, 1), padding 480ms ease",
              }}
            >
              <div
                style={{
                  overflow: "hidden",
                  textAlign: "center",
                  maxHeight: busy ? 0 : 400,
                  opacity: busy ? 0 : 1,
                  marginBottom: busy ? 0 : 40,
                  transition:
                    "max-height 420ms ease, opacity 260ms ease, margin 420ms ease",
                }}
              >
                {/*
                  Sized against the viewport, not in fixed px. On a 16:9 recording
                  a 46px headline left the frame mostly empty; clamp lets the hero
                  scale with the window instead of stranding it in the middle.
                */}
                <h1
                  style={{
                    fontSize: "clamp(44px, 4.6vw, 78px)",
                    lineHeight: 1.02,
                    fontWeight: 600,
                    letterSpacing: "-0.042em",
                    margin: "0 0 20px",
                  }}
                >
                  Ask about anything on X
                </h1>
                <p
                  style={{
                    fontSize: "clamp(16px, 1.28vw, 22px)",
                    lineHeight: 1.5,
                    color: "var(--text-2)",
                    margin: "0 auto",
                    maxWidth: "38ch",
                  }}
                >
                  grok-4.6 searches X server-side, then builds the surface out
                  of real components as it reads.
                </p>
              </div>

              {/*
                Transcript. Visible from the moment the run starts, not from
                the moment the canvas opens — during the ~60s search this is
                the ONLY thing telling you the agent is working, so it takes
                the hero's place instead of staying collapsed.
              */}
              <div
                className="chat-scroll"
                style={{
                  flex: busy ? 1 : "none",
                  minHeight: 0,
                  height: busy ? "auto" : 0,
                  maxHeight: searching ? "46vh" : undefined,
                  opacity: busy ? 1 : 0,
                  overflow: "hidden",
                  transition: "opacity 280ms ease 120ms",
                }}
              >
                {scrollView}
              </div>

              <div style={{ flexShrink: 0, marginTop: busy ? 10 : 0 }}>
                {input}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  justifyContent: "center",
                  overflow: "hidden",
                  maxHeight: busy ? 0 : 80,
                  opacity: busy ? 0 : 1,
                  marginTop: busy ? 0 : 22,
                  transition:
                    "max-height 380ms ease, opacity 240ms ease, margin 380ms ease",
                }}
              >
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void ask(s)}
                    className="pill mono suggestion"
                    style={{ background: "transparent", cursor: "pointer" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </aside>
          </div>
        </main>
      )}
    </CopilotChatView>
  );
}
