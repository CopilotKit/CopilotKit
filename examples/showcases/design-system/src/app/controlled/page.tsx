"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  CopilotChat,
  useAgentContext,
  useComponent,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { SiteNav } from "@/components/SiteNav";
import { Split } from "@/components/Split";
import { StockCard } from "@/components/StockCard";
import { STOCKS, getStock, type Stock } from "@/lib/stocks";

type Mode = "in-chat" | "split";

export default function ControlledPage() {
  const [mode, setMode] = useState<Mode>("in-chat");
  const [pinned, setPinned] = useState<Stock[]>([]);

  useAgentContext({
    description: "Available stock tickers.",
    value: STOCKS.map((s) => ({
      ticker: s.ticker,
      company: s.company,
      sector: s.sector,
    })),
  });

  /* In-chat: useComponent renders the card inside the conversation. */
  useComponent({
    name: "showStock",
    description:
      "Show a stock as a card inline in the chat. Use when the user asks to see a single ticker.",
    parameters: z.object({
      ticker: z.string().describe("Ticker symbol, e.g. AAPL"),
    }),
    render: ({ ticker }) => {
      const stock = ticker ? getStock(ticker) : undefined;
      if (!stock) {
        return (
          <div className="surface-soft px-3 py-2 text-[12px] text-[var(--ink)]">
            Loading {ticker ?? "stock"}…
          </div>
        );
      }
      return (
        <div className="my-2 max-w-[360px]">
          <StockCard stock={stock} />
        </div>
      );
    },
    followUp: false,
  });

  /* In-app: useFrontendTool handler mutates page state. The card
     renders in the workspace panel, not in the chat. We also pass a
     small `render` so the chat shows a one-line confirmation log when
     the agent calls the tool — so the reader can see "this is a tool
     call" the same way A2UI surfaces show a tool log. */
  useFrontendTool({
    name: "pinStock",
    description:
      "Pin a stock to the workspace panel. Use when the user says pin, track, save, or add a ticker to the workspace.",
    parameters: z.object({
      ticker: z.string().describe("Ticker symbol to pin."),
    }),
    handler: async ({ ticker }) => {
      const stock = getStock(ticker);
      if (!stock) return { ok: false, reason: "unknown ticker" };
      setPinned((cur) =>
        cur.find((s) => s.ticker === stock.ticker) ? cur : [...cur, stock],
      );
      return { ok: true, pinned: stock.ticker };
    },
  });

  useFrontendTool({
    name: "unpinStock",
    description:
      "Remove a single stock from the workspace. Use when the user says remove, unpin, or take off a specific ticker.",
    parameters: z.object({
      ticker: z.string().describe("Ticker symbol to unpin."),
    }),
    handler: async ({ ticker }) => {
      const t = ticker.toUpperCase();
      setPinned((cur) => cur.filter((s) => s.ticker !== t));
      return { ok: true, removed: t };
    },
  });

  useFrontendTool({
    name: "clearWorkspace",
    description: "Remove every pinned stock from the workspace.",
    parameters: z.object({}),
    handler: async () => {
      setPinned([]);
      return { ok: true };
    },
  });

  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      { title: "Show me NVDA", message: "Show me NVDA", isLoading: false },
      {
        title: "Pin TSLA to my workspace",
        message: "Pin TSLA to my workspace",
        isLoading: false,
      },
      {
        title: "Remove TSLA",
        message: "Remove TSLA from my workspace",
        isLoading: false,
      },
    ],
  });

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav />

      <PageHeader
        title="Your component, the agent fills the props"
        subtitle="Pre-build the component. The agent decides when to render it and what props to pass."
        mode={mode}
        onMode={setMode}
      />

      <main className="flex-1 flex flex-col max-w-[1480px] mx-auto px-5 py-5 w-full min-h-0">
        {mode === "in-chat" ? (
          <SingleChat />
        ) : (
          <SplitView
            pinned={pinned}
            onRemove={(t) =>
              setPinned((cur) => cur.filter((s) => s.ticker !== t))
            }
          />
        )}
      </main>
    </div>
  );
}

function SingleChat() {
  return (
    <div className="flex-1 min-h-0 w-full max-w-[860px] mx-auto">
      <ChromePanel
        caption="Chat"
        hint={
          <>
            Try <Try>show me NVDA</Try>
          </>
        }
      >
        <div className="h-full flex flex-col copilot-chat-wrapper">
          <CopilotChat
            agentId="controlled"
            labels={{
              chatInputPlaceholder: "Try: show me NVDA",
              welcomeMessageText: "How can I help?",
            }}
          />
        </div>
      </ChromePanel>
    </div>
  );
}

function SplitView({
  pinned,
  onRemove,
}: {
  pinned: Stock[];
  onRemove: (ticker: string) => void;
}) {
  return (
    <Split
      persistKey="ads-controlled-split"
      initialLeftFraction={0.36}
      minFraction={0.25}
      left={
        <ChromePanel
          caption="Chat"
          hint={
            <>
              Try <Try>show me NVDA</Try>
            </>
          }
        >
          <div className="h-full flex flex-col copilot-chat-wrapper">
            <CopilotChat
              agentId="controlled"
              labels={{
                chatInputPlaceholder: "Try: pin TSLA to my workspace",
                welcomeMessageText: "How can I help?",
              }}
            />
          </div>
        </ChromePanel>
      }
      right={
        <ChromePanel
          caption="Side panel"
          hint={
            <>
              Try <Try>pin NVDA</Try> · <Try>clear the workspace</Try>
            </>
          }
        >
          <div className="flex-1 overflow-y-auto p-5">
            {pinned.length === 0 ? (
              <EmptyState
                title="Nothing pinned yet"
                body="Ask the agent to pin a ticker. Cards land here, not in chat."
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pinned.map((s) => (
                  <RemovableCard
                    key={s.ticker}
                    stock={s}
                    onRemove={() => onRemove(s.ticker)}
                  />
                ))}
              </div>
            )}
          </div>
        </ChromePanel>
      }
    />
  );
}

function RemovableCard({
  stock,
  onRemove,
}: {
  stock: Stock;
  onRemove: () => void;
}) {
  return (
    <div className="relative group">
      <StockCard stock={stock} />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${stock.ticker}`}
        className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center bg-[var(--surface)] border border-[var(--line)] text-[var(--ink)] opacity-0 group-hover:opacity-100 transition hover:bg-[var(--surface-soft)]"
      >
        <X size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/* ----- shared chrome (used by /controlled, /declarative, /open) ---- */

export function PageHeader({
  title,
  subtitle,
  mode,
  onMode,
}: {
  title: string;
  subtitle: string;
  mode: Mode;
  onMode: (m: Mode) => void;
}) {
  return (
    <section className="border-b border-[var(--line)]">
      <div className="max-w-[1480px] mx-auto px-5 py-3.5 flex items-center justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-[var(--ink)]">
            {title}
          </h1>
          <p className="text-[12.5px] text-[var(--ink-2)] mt-0.5 max-w-[640px] leading-snug">
            {subtitle}
          </p>
        </div>
        <ModeTabs mode={mode} onMode={onMode} />
      </div>
    </section>
  );
}

export function ModeTabs({
  mode,
  onMode,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
}) {
  const opts: { id: Mode; label: string }[] = [
    { id: "in-chat", label: "In chat" },
    { id: "split", label: "In chat + In app" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Surface"
      className="inline-flex p-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)]"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === mode}
          onClick={() => onMode(o.id)}
          className={`px-3 py-1.5 text-[12.5px] font-medium rounded-[calc(var(--radius)-4px)] transition ${
            o.id === mode
              ? "bg-[var(--surface-soft)] text-[var(--ink)]"
              : "text-[var(--muted)] hover:text-[var(--ink)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ChromePanel({
  caption,
  hint,
  children,
}: {
  caption: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="surface flex flex-col overflow-hidden h-full min-h-0">
      <header className="px-4 py-2.5 border-b border-[var(--line)] bg-[var(--surface-soft)] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "var(--accent)" }}
            aria-hidden
          />
          <span className="font-display text-[12.5px] font-medium tracking-tight text-[var(--ink)] truncate">
            {caption}
          </span>
        </div>
        {hint && (
          <span className="text-[11.5px] text-[var(--muted)] truncate">
            {hint}
          </span>
        )}
      </header>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}

export function Try({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[10.5px] px-1.5 py-0.5 rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]">
      &quot;{children}&quot;
    </code>
  );
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="h-full flex items-center justify-center text-center px-6">
      <div className="max-w-[320px] flex flex-col items-center gap-2">
        <div
          className="w-10 h-10 rounded-md border border-dashed border-[var(--line)]"
          aria-hidden
        />
        <h3 className="font-display text-[14px] font-semibold tracking-tight text-[var(--ink)] mt-1">
          {title}
        </h3>
        <p className="text-[12.5px] text-[var(--ink-2)] leading-relaxed">
          {body}
        </p>
      </div>
    </div>
  );
}
