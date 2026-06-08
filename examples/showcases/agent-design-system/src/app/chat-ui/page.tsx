"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bot,
  Cloud,
  CloudRain,
  Droplets,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  Sun,
  Wind,
} from "lucide-react";
import { z } from "zod";
import type {
  CopilotChatAssistantMessageProps,
  CopilotChatUserMessage,
} from "@copilotkit/react-core/v2";
import {
  CopilotChat,
  CopilotChatAssistantMessage,
  useAgent,
  useComponent,
  useCopilotKit,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import { SiteNav } from "@/components/SiteNav";

type Variant = "css" | "slots" | "headless";

const VARIANTS: { id: Variant; label: string; title: string }[] = [
  { id: "css", label: "Customized with CSS", title: "Customized with CSS" },
  { id: "slots", label: "Replace a sub-component", title: "Replace a slot" },
  {
    id: "headless",
    label: "Headless",
    title: "Design it from scratch using Headless",
  },
];

const SUGGESTIONS = [
  "What can you do?",
  "Tell me a one-line joke.",
  "Summarize the headlines.",
  "Give me a fun fact.",
];

/* ==================================================================
   Generative UI: a Weather card the agent can render in the chat.
   Registered ONCE at the page level — every CopilotChat instance on
   this page picks it up automatically because they all bind to the
   same default agent. In the headless variant we render it manually
   via useRenderToolCall.
   ================================================================== */

const weatherSchema = z.object({
  city: z.string().describe("City name"),
  temperatureF: z.number().describe("Temperature in Fahrenheit"),
  condition: z.enum(["sunny", "cloudy", "rainy"]).describe("Weather condition"),
  humidity: z.number().describe("Humidity percent, 0-100"),
  windMph: z.number().describe("Wind speed in miles per hour"),
});

function WeatherCard({
  city,
  temperatureF,
  condition,
  humidity,
  windMph,
}: z.infer<typeof weatherSchema>) {
  const Icon =
    condition === "sunny" ? Sun : condition === "rainy" ? CloudRain : Cloud;
  const conditionLabel =
    condition === "sunny"
      ? "Sunny"
      : condition === "rainy"
        ? "Rainy"
        : "Cloudy";

  return (
    <div className="my-3 max-w-[360px] surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink)] font-semibold">
            Weather
          </span>
          <h3 className="font-display text-[16px] font-semibold tracking-tight text-[var(--ink)] mt-0.5">
            {city}
          </h3>
        </div>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
          aria-hidden
        >
          <Icon size={20} strokeWidth={2} className="text-[var(--ink)]" />
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[36px] font-semibold tracking-tight text-[var(--ink)] tabular-nums leading-none">
          {Math.round(temperatureF)}°
        </span>
        <span className="text-[13px] text-[var(--ink)] font-medium">
          {conditionLabel}
        </span>
      </div>
      <div className="flex items-center gap-4 pt-2 border-t border-[var(--line)]">
        <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--ink)] font-medium">
          <Droplets size={13} strokeWidth={2} className="text-[var(--ink)]" />
          <span className="tabular-nums">{humidity}%</span>
        </div>
        <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--ink)] font-medium">
          <Wind size={13} strokeWidth={2} className="text-[var(--ink)]" />
          <span className="tabular-nums">{Math.round(windMph)} mph</span>
        </div>
      </div>
    </div>
  );
}

export default function ChatUIPage() {
  const [active, setActive] = useState<Variant>("css");
  const current = VARIANTS.find((v) => v.id === active)!;

  /* Register the weather card as a generative-UI tool agent-wide.
     followUp: false stops the agent from emitting an extra paragraph
     after the card renders — the card IS the answer. */
  useComponent({
    name: "showWeather",
    description:
      "Show a weather card inline in the chat. Call this when the user asks about the weather in a city.",
    parameters: weatherSchema,
    render: WeatherCard,
    followUp: false,
  });

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav />

      <section className="border-b border-[var(--line)]">
        <div className="max-w-[1480px] mx-auto px-5 py-3.5 flex items-center justify-between gap-6 flex-wrap">
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-[var(--ink)]">
            {current.title}
          </h1>

          <div
            role="tablist"
            aria-label="Customization variant"
            className="inline-flex p-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)]"
          >
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={v.id === active}
                onClick={() => setActive(v.id)}
                className={`px-3 py-1.5 text-[12.5px] font-medium rounded-[calc(var(--radius)-4px)] transition ${
                  v.id === active
                    ? "bg-[var(--surface-soft)] text-[var(--ink)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="flex-1 max-w-[1480px] mx-auto px-5 py-5 w-full min-h-0">
        {active === "css" ? <CssVariant /> : null}
        {active === "slots" ? <SlotsVariant /> : null}
        {active === "headless" ? <HeadlessVariant /> : null}
      </main>
    </div>
  );
}

/* ==================================================================
   Variant A — CSS customization
   ================================================================== */

function CssVariant() {
  return (
    <div className="grid lg:grid-cols-2 gap-4 h-full min-h-0">
      <ChromePanel caption="Default">
        <div className="copilot-chat-inset h-full flex flex-col">
          <CopilotChat
            attachments={{ enabled: true }}
            labels={{
              chatInputPlaceholder: "Ask me anything…",
              welcomeMessageText: "Hi. I'm your assistant.",
            }}
          />
        </div>
      </ChromePanel>
      <ChromePanel caption="Customized with CSS" surface="warm">
        {/* The broad reskin is all CSS: `.ads-warm [data-copilotkit]`
            remaps the v2 token layer (palette, radius, serif font) for
            every chat primitive. On top of that, a few slot props add
            the bespoke touches the token layer can't express — an
            eyebrow welcome, a left-rule user bubble — and close the two
            spots that hardcode bg-white / bg-black (input + buttons). */}
        <div className="ads-warm copilot-chat-inset h-full flex flex-col">
          <CopilotChat
            attachments={{ enabled: true }}
            messageView={{
              className: "!pt-6",
              assistantMessage: {
                className:
                  "!bg-transparent !border-0 !border-l-[3px] !border-l-[var(--warm-accent)] !rounded-none !pl-6 !pr-2 !my-5",
                toolbarVisible: false,
              },
              userMessage: WarmUser as unknown as typeof CopilotChatUserMessage,
            }}
            input={{
              // The border/sharp-corners belong on the pill itself
              // (`.copilotKitInput`), not the input container — the
              // container also wraps the disclaimer, so bordering it
              // boxes the "AI can make mistakes" line too. There's no
              // slot for the pill, so target it with a child variant.
              className:
                "[&_.copilotKitInput]:!rounded-none [&_.copilotKitInput]:!border [&_.copilotKitInput]:!border-[var(--warm-accent)] [&_.copilotKitInput]:!bg-white [&_.copilotKitInput]:!shadow-none",
              textArea: { className: "placeholder:!italic" },
              addMenuButton: {
                className:
                  "!bg-[#f5cdb5] !text-[var(--warm-accent)] !rounded-[6px]",
              },
              // Force solid terracotta even when disabled (empty input):
              // the variant's disabled state is a pale grey otherwise.
              sendButton: {
                className:
                  "!rounded-[6px] !bg-[var(--warm-accent)] !text-white disabled:!bg-[var(--warm-accent)] disabled:!text-white disabled:!opacity-100 [&_svg]:!text-white",
              },
            }}
            welcomeScreen={WarmWelcome}
            labels={{
              chatInputPlaceholder: "Type a message…",
            }}
          />
        </div>
      </ChromePanel>
    </div>
  );
}

/* ---------- Warm-variant slots (eyebrow welcome + left-rule user) ---
   These add bespoke structure the token layer can't express. Theming
   (palette/serif) still comes from the .ads-warm tokens; these only
   add the extra elements (eyebrow, arrow, sharp white box). */

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as unknown[])
      .map((p) =>
        typeof p === "object" && p !== null && "text" in p
          ? String((p as { text: string }).text)
          : "",
      )
      .join("");
  }
  return "";
}

function WarmWelcome({
  input,
}: {
  input?: React.ReactNode;
  suggestionView?: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 gap-4">
      <span
        className="font-mono text-[12px] uppercase tracking-[0.18em] font-semibold"
        style={{ color: "var(--warm-accent)" }}
      >
        CopilotKit
      </span>
      <h2
        className="text-center"
        style={{
          fontFamily: "var(--warm-serif)",
          fontStyle: "italic",
          fontWeight: 500,
          fontSize: "44px",
          lineHeight: 1.1,
          color: "#1f1a13",
          letterSpacing: "-0.01em",
        }}
      >
        How can I help you today?
      </h2>
      <div
        className="h-px w-12"
        style={{ background: "var(--warm-line)" }}
        aria-hidden
      />
      <div className="w-full max-w-[680px] mt-4">{input}</div>
    </div>
  );
}

function WarmUser({
  message,
}: {
  message: { id: string; role: string; content?: unknown };
}) {
  const text = extractText(message.content);
  if (!text.trim()) return null;
  return (
    <div className="flex justify-end my-3 mx-1">
      <div
        className="inline-flex items-center gap-3 pl-5 pr-5 py-2.5 text-[14px]"
        style={{
          background: "#ffffff",
          color: "#1f1a13",
          borderLeft: "4px solid #c25c34",
          borderTop: "1px solid var(--warm-line)",
          borderRight: "1px solid var(--warm-line)",
          borderBottom: "1px solid var(--warm-line)",
          borderRadius: 0,
        }}
      >
        <span style={{ color: "#c25c34" }}>→</span>
        {text}
      </div>
    </div>
  );
}

/* ==================================================================
   Variant B — slot replacement, with Lucide bot avatar.
   We render text directly so no inner markdown card brings white in.
   ================================================================== */

function ThemedAssistant(props: CopilotChatAssistantMessageProps) {
  return (
    <div className="flex gap-3 my-3 mx-1">
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
        style={{
          background: "var(--accent-soft)",
          color: "var(--accent-strong)",
          border: "1px solid var(--line)",
        }}
        aria-hidden
      >
        <Bot size={14} strokeWidth={2} />
      </div>
      <div
        className="px-3.5 py-2.5 max-w-[560px] text-[14px] leading-relaxed rounded-[var(--radius)] [&_p]:!m-0 [&_p+p]:!mt-2 [&_ul]:!my-2 [&_li]:!my-0.5"
        style={{
          background: "var(--surface-soft)",
          color: "var(--ink)",
          border: "1px solid var(--line)",
        }}
      >
        {/* The default message root carries `data-copilotkit`, which
            paints `background-color: var(--background)` (white) — that
            would sit on top of our --surface-soft bubble. Make it
            transparent so the bubble color shows through. */}
        <CopilotChatAssistantMessage
          {...props}
          toolbarVisible={false}
          className="!bg-transparent"
        />
      </div>
    </div>
  );
}

function SlotsVariant() {
  return (
    <div className="h-full min-h-0 max-w-[860px] mx-auto">
      <ChromePanel caption="App-themed shell · custom assistant slot">
        {/* ads-chat-themed maps our design tokens onto the v2 token
            layer, so the shell matches the app — and the assistant
            slot below is swapped for a custom component. Tokens +
            slot, composed. */}
        <div className="ads-chat-themed copilot-chat-inset h-full flex flex-col">
          <CopilotChat
            attachments={{ enabled: true }}
            messageView={{
              assistantMessage:
                ThemedAssistant as unknown as typeof CopilotChatAssistantMessage,
            }}
            labels={{
              chatInputPlaceholder: "Ask me anything…",
              welcomeMessageText: "Hi. I'm your assistant.",
            }}
          />
        </div>
      </ChromePanel>
    </div>
  );
}

/* ==================================================================
   Variant C — fully headless, matching the "Complete" reference.
   ================================================================== */

function HeadlessVariant() {
  return (
    <div className="h-full min-h-0 max-w-[860px] mx-auto">
      <HeadlessChat />
    </div>
  );
}

function HeadlessChat() {
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();
  const renderToolCall = useRenderToolCall();
  const [input, setInput] = useState("");
  const [attached, setAttached] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.messages.length]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      });
      setInput("");
      setAttached(null);
      await copilotkit.runAgent({ agent });
    },
    [agent, copilotkit],
  );

  const handleReset = () => {
    setInput("");
    setAttached(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius)] overflow-hidden">
      <header className="px-5 py-4 border-b border-[var(--line)] flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles
              size={16}
              className="text-[var(--accent-strong)]"
              aria-hidden
            />
            <h2 className="font-display text-[15px] font-semibold tracking-tight text-[var(--ink)]">
              Headless Chat
            </h2>
          </div>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            No &lt;CopilotChat&gt;. Just two hooks and our own components.
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="text-[var(--muted)] hover:text-[var(--ink)] transition"
          aria-label="Reset conversation"
        >
          <RotateCcw size={16} strokeWidth={2} />
        </button>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {agent.messages.length === 0 ? (
          <WelcomeState onSuggest={(s) => send(s)} />
        ) : (
          <div className="space-y-3">
            {agent.messages.map((m, i) => {
              const tcs =
                "toolCalls" in m && Array.isArray(m.toolCalls)
                  ? (m.toolCalls as Array<{ id: string }>)
                  : [];
              return (
                <div key={m.id} className="space-y-2">
                  <HeadlessBubble message={m} />
                  {tcs.map((tc) => {
                    const toolMessage = agent.messages
                      .slice(i + 1)
                      .find(
                        (x) =>
                          x.role === "tool" &&
                          "toolCallId" in x &&
                          (x as { toolCallId?: string }).toolCallId === tc.id,
                      );
                    const el = renderToolCall({
                      toolCall: tc as never,
                      toolMessage: toolMessage as never,
                    });
                    return el ? <div key={tc.id}>{el}</div> : null;
                  })}
                </div>
              );
            })}
            {agent.isRunning && (
              <div className="text-[12.5px] text-[var(--muted)] animate-pulse pl-1">
                Thinking…
              </div>
            )}
          </div>
        )}
      </div>

      {attached && (
        <div className="mx-4 mb-2 inline-flex items-center gap-2 self-start px-2.5 py-1 rounded-md bg-[var(--surface-soft)] border border-[var(--line)] text-[12px] text-[var(--ink-2)]">
          <Paperclip size={12} strokeWidth={2} />
          <span className="truncate max-w-[260px]">{attached.name}</span>
          <button
            type="button"
            onClick={() => setAttached(null)}
            className="text-[var(--muted)] hover:text-[var(--ink)] ml-1"
            aria-label="Remove attachment"
          >
            ×
          </button>
        </div>
      )}

      <form
        className="mx-4 mb-3 border border-[var(--line)] rounded-[var(--radius)] bg-[var(--surface)] flex items-center gap-2 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-[var(--muted)] hover:text-[var(--ink)] transition shrink-0"
          aria-label="Attach a file"
        >
          <Paperclip size={16} strokeWidth={2} />
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => setAttached(e.target.files?.[0] ?? null)}
        />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message the agent or drop a file…"
          aria-label="Message"
          className="flex-1 bg-transparent text-[14px] text-[var(--ink)] placeholder:text-[var(--muted-2)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={agent.isRunning || !input.trim()}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition disabled:opacity-40"
          style={{ background: "var(--surface-soft)", color: "var(--ink)" }}
          aria-label="Send"
        >
          <Send size={14} strokeWidth={2} />
        </button>
      </form>

      <div className="px-4 pb-3 text-center text-[11.5px] text-[var(--muted)]">
        Press{" "}
        <kbd className="font-mono text-[10.5px] px-1.5 py-0.5 rounded border border-[var(--line)] bg-[var(--surface-soft)]">
          Enter
        </kbd>{" "}
        to send,{" "}
        <kbd className="font-mono text-[10.5px] px-1.5 py-0.5 rounded border border-[var(--line)] bg-[var(--surface-soft)]">
          Shift+Enter
        </kbd>{" "}
        for a newline.
      </div>
    </div>
  );
}

function WelcomeState({ onSuggest }: { onSuggest: (text: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-4">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ background: "var(--surface-soft)", color: "var(--ink)" }}
        aria-hidden
      >
        <Sparkles size={20} strokeWidth={1.8} />
      </div>
      <div className="max-w-md">
        <h3 className="font-display text-[18px] font-semibold tracking-tight text-[var(--ink)]">
          Built from scratch
        </h3>
        <p className="text-[13px] text-[var(--ink-2)] mt-2 leading-relaxed">
          Messages, the composer, attachments, generative UI cards — all your
          own components on top of two CopilotKit hooks.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-1 max-w-md">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggest(s)}
            className="px-3 py-1.5 rounded-full text-[12.5px] border border-[var(--line)] bg-[var(--surface-soft)] hover:bg-[var(--surface)] text-[var(--ink-2)] transition"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

type ChatBubbleMessage = {
  id: string;
  role: string;
  content?: unknown;
};

function HeadlessBubble({ message }: { message: ChatBubbleMessage }) {
  const isUser = message.role === "user";
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((p) =>
              typeof p === "object" && p && "text" in p
                ? String((p as { text: string }).text)
                : "",
            )
            .join("")
        : "";
  if (!text.trim()) return null;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[78%] px-3.5 py-2 rounded-[var(--radius)] text-[14px] leading-relaxed"
          style={{ background: "var(--ink)", color: "var(--surface)" }}
        >
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
        style={{
          background: "var(--surface-soft)",
          color: "var(--ink)",
          border: "1px solid var(--line)",
        }}
        aria-hidden
      >
        <Bot size={14} strokeWidth={2} />
      </div>
      <div
        className="px-3.5 py-2 max-w-[78%] text-[14px] leading-relaxed rounded-[var(--radius)] prose-bubble"
        style={{
          background: "var(--surface-soft)",
          color: "var(--ink)",
          border: "1px solid var(--line)",
        }}
      >
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
    </div>
  );
}

/* ==================================================================
   Shared chrome
   ================================================================== */

function ChromePanel({
  caption,
  children,
  surface,
}: {
  caption: string;
  children: React.ReactNode;
  surface?: "default" | "warm";
}) {
  const headerBg = surface === "warm" ? "#f0e7d3" : "var(--surface-soft)";
  const panelBg = surface === "warm" ? "#f7f1e7" : "var(--surface)";
  const border = surface === "warm" ? "#e6dac4" : "var(--line)";

  return (
    <div
      className="flex flex-col overflow-hidden h-full min-h-0 rounded-[var(--radius)]"
      style={{
        background: panelBg,
        border: `1px solid ${border}`,
      }}
    >
      <div
        className="px-4 py-2.5 border-b flex items-center gap-2 shrink-0"
        style={{ background: headerBg, borderColor: border }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: surface === "warm" ? "#c89b4a" : "var(--accent)",
          }}
          aria-hidden
        />
        <span
          className="font-display text-[12.5px] font-medium tracking-tight"
          style={{ color: surface === "warm" ? "#1f1a13" : "var(--ink)" }}
        >
          {caption}
        </span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col px-3 pb-3">{children}</div>
    </div>
  );
}
