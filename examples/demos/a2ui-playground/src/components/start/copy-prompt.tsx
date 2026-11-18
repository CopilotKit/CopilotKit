"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useDesignSystem } from "@/design-systems/context";
import { copyText } from "@/lib/copy-text";
import { cn, focusRing } from "@/lib/utils";
import { CODE_FADE, CODE_SURFACE, CommandLine } from "./code-block";
import { highlightCode } from "./highlight";
import { buildPrompt } from "./prompt";
import { Steps } from "./steps";
import { Tabs } from "./tabs";

type Agent =
  | "antigravity"
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "hermes";

const START = "Start the agent in your app's folder, then paste.";

/**
 * The coding agents, each with its logo (public/brand/agents, LobeHub icons) and how to start it in a project.
 * `color`: the brand's colour logo. Cursor, OpenCode and Nous Research have one-colour marks, drawn in ink.
 */
const AGENTS: Array<{
  id: Agent;
  label: string;
  logo: string;
  color?: boolean;
  command: string;
  help: string;
}> = [
  // Google's terminal agent: Antigravity CLI took over from Gemini CLI for individual users in June 2026.
  {
    id: "antigravity",
    label: "Antigravity CLI",
    logo: "antigravity-color",
    color: true,
    command: "agy",
    help: START,
  },
  {
    id: "claude",
    label: "Claude Code",
    logo: "claude-color",
    color: true,
    command: "claude",
    help: START,
  },
  {
    id: "codex",
    label: "Codex",
    logo: "codex-color",
    color: true,
    command: "codex",
    help: START,
  },
  {
    id: "cursor",
    label: "Cursor",
    logo: "cursor",
    command: "cursor .",
    help: "Open your app's folder in Cursor, open the Agent chat, then paste.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    logo: "opencode",
    command: "opencode",
    help: START,
  },
  // Hermes Agent, by Nous Research: shown with the Nous mark.
  {
    id: "hermes",
    label: "Hermes",
    logo: "nousresearch",
    command: "hermes",
    help: START,
  },
];

/**
 * An agent's logo from public/brand/agents, at full strength on every tab: a colour logo as an image, a
 * one-colour mark in ink through a CSS mask (so it follows the theme).
 */
function AgentLogo({ name, color }: { name: string; color?: boolean }) {
  if (color)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/brand/agents/${name}.svg`}
        alt=""
        aria-hidden
        className="size-3.5 flex-none"
      />
    );
  return (
    <span
      aria-hidden
      className="size-3.5 flex-none bg-foreground [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
      style={{ maskImage: `url(/brand/agents/${name}.svg)` }}
    />
  );
}

/** The agent path: copy the prompt, paste it into a coding agent, then add a key and run the app. */
export function CopyPrompt() {
  const { id } = useDesignSystem();
  // The prompt links this site; its address is known in the browser only.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const prompt = buildPrompt(id, origin);

  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<Agent>("antigravity");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copy = () => {
    void copyText(prompt).then((ok) => {
      setCopied(ok);
      if (!ok) return;
      clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), 1800);
    });
  };
  const a = AGENTS.find((x) => x.id === agent) ?? AGENTS[0];

  return (
    <Steps
      start={3}
      rise={4}
      steps={[
        {
          title: "Copy the prompt",
          body: (
            <div className={cn("overflow-hidden", CODE_SURFACE)}>
              <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border py-1 pl-4 pr-1.5">
                <span className="font-mono text-[12.5px] text-muted-foreground">
                  setup-prompt.md
                </span>
                <button
                  type="button"
                  onClick={copy}
                  data-copy-prompt
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[12.5px] font-medium text-background transition-opacity hover:opacity-85",
                    focusRing,
                  )}
                >
                  {copied ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <Copy className="size-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy prompt"}
                </button>
                <span role="status" className="sr-only">
                  {copied ? "Prompt copied" : ""}
                </span>
              </div>
              <div className="relative">
                <pre
                  id="start-prompt"
                  className={cn(
                    "a2-code whitespace-pre-wrap px-5 pt-4 font-mono text-[13px] leading-[1.7] text-[var(--sh-identifier)] [scrollbar-width:thin] dark:[color-scheme:dark]",
                    open
                      ? "max-h-[440px] overflow-auto pb-14"
                      : "max-h-[168px] overflow-hidden",
                  )}
                  // Escaped by the highlighter: the prompt carries this site's address, nothing else from outside.
                  dangerouslySetInnerHTML={{
                    __html: highlightCode(prompt, "md"),
                  }}
                />
                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3 pt-10",
                    !open && CODE_FADE,
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls="start-prompt"
                    onClick={() => setOpen((v) => !v)}
                    className={cn(
                      "pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-3 text-[12.5px] font-medium text-foreground shadow-[0_1px_2px_oklch(var(--ink)/6%)] transition-colors hover:border-foreground/30 dark:bg-[#141416]",
                      focusRing,
                    )}
                  >
                    {open ? "Collapse" : "Show full prompt"}
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        open && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
            </div>
          ),
        },
        {
          title: "Paste it into your coding agent",
          help: a.help,
          body: (
            <div className="flex flex-col gap-2.5">
              <Tabs
                options={AGENTS.map((x) => ({
                  id: x.id,
                  label: (
                    <>
                      <AgentLogo name={x.logo} color={x.color} />
                      {x.label}
                    </>
                  ),
                }))}
                value={agent}
                onChange={setAgent}
                label="Coding agent"
                idBase="start-agent"
                className="max-w-full self-start overflow-x-auto [scrollbar-width:none]"
              />
              <div
                role="tabpanel"
                id={`start-agent-panel-${agent}`}
                aria-labelledby={`start-agent-tab-${agent}`}
              >
                <CommandLine command={`cd your-app && ${a.command}`} />
              </div>
            </div>
          ),
        },
        {
          title: "Add a Gemini key and run your app",
          help: (
            <>
              Put a{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
              >
                Gemini API key
              </a>{" "}
              in <code className="font-mono text-[13px]">.env.local</code> as{" "}
              <code className="font-mono text-[13px]">GOOGLE_API_KEY</code>,
              then ask the chat for &ldquo;a dashboard of this week&apos;s
              signups&rdquo;.
            </>
          ),
        },
      ]}
    />
  );
}
