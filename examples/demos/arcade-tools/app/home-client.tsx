"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  CopilotChat,
  useConfigureSuggestions,
  useDefaultRenderTool,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ArcadeWordmark } from "@/components/arcade-wordmark";
import type { ArcadeResult } from "@/components/tool-cards";
import {
  AuthorizationCard,
  EmailListCard,
  EmailSentCard,
  ErrorCard,
  GenericToolCard,
  LoadingCard,
  NewsCard,
  extractEmails,
  extractNews,
  parseResult,
} from "@/components/tool-cards";

const isAuth = (
  r: ArcadeResult | undefined,
): r is Extract<ArcadeResult, { authorizationRequired: true }> =>
  !!r && "authorizationRequired" in r && r.authorizationRequired === true;
const isError = (
  r: ArcadeResult | undefined,
): r is Extract<ArcadeResult, { error: string }> => !!r && "error" in r;
const outputOf = (r: ArcadeResult | undefined): unknown =>
  r && "output" in r ? r.output : null;

function ToolRenderers() {
  // sendEmail is the headline flow: it shows the Connect card, then the sent card.
  useRenderTool({
    name: "sendEmail",
    parameters: z.object({
      recipient: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
    render: ({ status, parameters, result }) => {
      if (status === "inProgress")
        return <LoadingCard label="Preparing email…" />;
      if (status === "executing")
        return (
          <LoadingCard
            label={`Sending email to ${parameters.recipient ?? "…"}…`}
          />
        );

      const r = parseResult<ArcadeResult>(result);
      if (isError(r)) return <ErrorCard message={r.error} />;
      if (isAuth(r))
        return <AuthorizationCard provider={r.provider} authUrl={r.authUrl} />;
      return (
        <EmailSentCard
          recipient={parameters.recipient}
          subject={parameters.subject}
        />
      );
    },
  });

  // listEmails reads the inbox (also gated by the same Gmail Connect flow).
  useRenderTool({
    name: "listEmails",
    parameters: z.object({
      n_emails: z.number().optional(),
    }),
    render: ({ status, result }) => {
      if (status !== "complete")
        return <LoadingCard label="Reading your inbox…" />;

      const r = parseResult<ArcadeResult>(result);
      if (isError(r)) return <ErrorCard message={r.error} />;
      if (isAuth(r))
        return <AuthorizationCard provider={r.provider} authUrl={r.authUrl} />;
      return <EmailListCard emails={extractEmails(outputOf(r))} />;
    },
  });

  // searchNews needs no auth, so it usually goes straight to results.
  useRenderTool({
    name: "searchNews",
    parameters: z.object({ keywords: z.string() }),
    render: ({ status, parameters, result }) => {
      if (status !== "complete")
        return (
          <LoadingCard
            label={`Searching news${parameters?.keywords ? ` for “${parameters.keywords}”` : ""}…`}
          />
        );

      const r = parseResult<ArcadeResult>(result);
      if (isError(r)) return <ErrorCard message={r.error} />;
      if (isAuth(r))
        return <AuthorizationCard provider={r.provider} authUrl={r.authUrl} />;
      return (
        <NewsCard
          keywords={parameters.keywords}
          stories={extractNews(outputOf(r))}
        />
      );
    },
  });

  // Fallback for any other tool, but hide CopilotKit's internal state tools.
  useDefaultRenderTool({
    render: ({ name, status }) => {
      // Hide CopilotKit's internal state tools; render a generic card otherwise.
      if (name.startsWith("AGUI")) return <></>;
      return <GenericToolCard name={name} done={status === "complete"} />;
    },
  });

  return null;
}

function Suggestions() {
  useConfigureSuggestions(
    {
      instructions:
        "Suggest 3 short, varied example prompts for an assistant that can search Google News and read or send Gmail via Arcade. Include one that sends an email and one that chains a news search into an email.",
      minSuggestions: 3,
      maxSuggestions: 3,
      available: "before-first-message",
    },
    [],
  );
  return null;
}

type IconProps = { className?: string };
const Stroke = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);
const MailIcon = (p: IconProps) => (
  <Stroke className={p.className}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Stroke>
);
const InboxIcon = (p: IconProps) => (
  <Stroke className={p.className}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  </Stroke>
);
const NewsIcon = (p: IconProps) => (
  <Stroke className={p.className}>
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
    <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z" />
  </Stroke>
);

const CAPABILITIES = [
  {
    name: "Send Gmail",
    desc: "Drafts and sends real email, gated by a one-time Connect card.",
    icon: MailIcon,
    tone: "text-emerald-600 bg-emerald-50 ring-emerald-100",
  },
  {
    name: "Read inbox",
    desc: "Lists recent messages once Gmail is authorized.",
    icon: InboxIcon,
    tone: "text-violet-600 bg-violet-50 ring-violet-100",
  },
  {
    name: "Search news",
    desc: "Google News, no auth needed, instant results.",
    icon: NewsIcon,
    tone: "text-sky-600 bg-sky-50 ring-sky-100",
  },
];

export function HomeClient({ keysConfigured }: { keysConfigured: boolean }) {
  return (
    <div className="relative min-h-full overflow-hidden bg-zinc-50 text-zinc-900">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_50%_-20%,#ddd6fe_0%,#eef2ff_30%,#f8fafc_60%,#ffffff_100%)]" />
      <div className="pointer-events-none absolute -left-32 top-24 -z-10 h-80 w-80 rounded-full bg-violet-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-10 -z-10 h-72 w-72 rounded-full bg-indigo-300/30 blur-3xl" />

      <ToolRenderers />
      <Suggestions />

      <div className="mx-auto w-full max-w-6xl px-5 py-7 sm:py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ArcadeWordmark className="h-5 w-auto text-zinc-900" />
            <span className="text-sm font-semibold tracking-tight text-zinc-400">
              × CopilotKit
            </span>
          </div>
          <nav className="flex items-center gap-1 text-sm font-medium">
            <a
              href="https://docs.arcade.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-3 py-1.5 text-zinc-500 transition-colors hover:bg-white/70 hover:text-zinc-900"
            >
              Arcade docs
            </a>
            <a
              href="https://docs.copilotkit.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-3 py-1.5 text-zinc-500 transition-colors hover:bg-white/70 hover:text-zinc-900"
            >
              CopilotKit docs
            </a>
          </nav>
        </header>

        <main className="mt-12 grid items-start gap-10 lg:mt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <section className="lg:sticky lg:top-10">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-violet-700 shadow-sm ring-1 ring-inset ring-violet-200/70 backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-600" />
              </span>
              Cookbook · Generative UI
            </span>
            <h1 className="mt-6 text-[2.7rem] font-semibold leading-[1.05] tracking-tight text-zinc-900 sm:text-[3.25rem]">
              Give your copilot{" "}
              <span className="bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent">
                authenticated tools
              </span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-zinc-600">
              This agent uses{" "}
              <span className="font-medium text-zinc-900">Arcade</span> to act
              on real services. When a tool needs OAuth, Arcade hands back an
              authorization URL and CopilotKit renders it as a{" "}
              <span className="font-medium text-zinc-900">Connect card</span>{" "}
              right in the chat. No credentials ever reach the model.
            </p>

            <ul className="mt-8 space-y-2.5">
              {CAPABILITIES.map((c) => {
                const Icon = c.icon;
                return (
                  <li
                    key={c.name}
                    className="flex items-center gap-3.5 rounded-xl border border-zinc-200/70 bg-white/70 px-4 py-3 shadow-sm ring-1 ring-inset ring-white/50 backdrop-blur transition-colors hover:bg-white"
                  >
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${c.tone}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900">
                        {c.name}
                      </p>
                      <p className="text-[13px] leading-snug text-zinc-500">
                        {c.desc}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {keysConfigured ? (
              <p className="mt-7 flex max-w-md items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-800 backdrop-blur">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                Keys detected. Ask the assistant on the right, then send an
                email to see the one-time{" "}
                <span className="font-medium">Connect</span> card.
              </p>
            ) : (
              <p className="mt-7 max-w-md rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 backdrop-blur">
                Add your{" "}
                <code className="font-mono text-[13px]">ARCADE_API_KEY</code>{" "}
                and{" "}
                <code className="font-mono text-[13px]">OPENAI_API_KEY</code> to{" "}
                <code className="font-mono text-[13px]">.env.local</code>, or{" "}
                <Link
                  href="/mock"
                  className="font-medium text-amber-900 underline underline-offset-2"
                >
                  see a static preview
                </Link>{" "}
                with no keys.
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/90 shadow-2xl shadow-violet-900/10 ring-1 ring-inset ring-white/60 backdrop-blur">
            <div className="flex items-center gap-3 border-b border-zinc-100 bg-white/60 px-4 py-3">
              <ArcadeWordmark className="h-4 w-auto text-zinc-900" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight text-zinc-900">
                  Assistant
                </p>
                <p className="text-[11px] leading-tight text-zinc-400">
                  Gmail · Google News, via Arcade
                </p>
              </div>
              {keysConfigured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Setup
                </span>
              )}
            </div>
            <div className="chat-fill h-[74vh] min-h-[560px]">
              <CopilotChat
                agentId="default"
                labels={{
                  welcomeMessageText:
                    "Hi! I'm your Arcade-powered assistant. I can search Google News and read or send your Gmail. Try a suggestion below. The first time I touch Gmail, you'll get a one-time Connect card.",
                  chatInputPlaceholder:
                    "Try: search news on AI agents and email me a summary…",
                }}
              />
            </div>
          </section>
        </main>

        <footer className="mt-12 flex flex-col items-center gap-1.5 pb-2 text-center text-xs text-zinc-400">
          <p>
            Built with{" "}
            <a
              href="https://www.arcade.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-500 hover:text-zinc-700"
            >
              Arcade
            </a>{" "}
            and{" "}
            <a
              href="https://www.copilotkit.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-500 hover:text-zinc-700"
            >
              CopilotKit
            </a>
            . Credentials are vaulted by Arcade and never shared with the model.
          </p>
          <Link
            href="/mock"
            className="font-medium text-zinc-500 hover:text-zinc-700"
          >
            View the static UI preview →
          </Link>
        </footer>
      </div>
    </div>
  );
}
