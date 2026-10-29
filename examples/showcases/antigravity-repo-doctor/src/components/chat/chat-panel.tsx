"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CopilotChat,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import Image from "next/image";
import { CircleAlert, Star, X } from "lucide-react";
import { AGENT_ID } from "@/lib/agent-id";
import { formatStars } from "@/lib/example-repos";
import type { RepoCardData } from "@/lib/example-repos";
import { cn } from "@/lib/cn";

// On a phone the full placeholder wraps to two lines, which switches the chat
// input to its taller two-row layout. Phones get a shorter one instead.
const PHONE = "(max-width: 639px)";
const PLACEHOLDER = "Ask about a repository, e.g. owner/name";
const PHONE_PLACEHOLDER = "Ask about a GitHub repo";

function subscribePhone(onChange: () => void) {
  const media = window.matchMedia(PHONE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function usePlaceholder() {
  const phone = useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
  return phone ? PHONE_PLACEHOLDER : PLACEHOLDER;
}

function useSend() {
  const { agent, isReady } = useAgent({ agentId: AGENT_ID });
  const { copilotkit } = useCopilotKit();
  // Until the runtime handshake finishes, useAgent hands out a stand-in agent
  // that is replaced once it does, taking any message added to it along. A
  // card clicked that early is held here and sent once the real agent exists.
  const queued = useRef<string | null>(null);
  const run = useCallback(
    async (text: string) => {
      if (agent.isRunning) return;
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      });
      await copilotkit.runAgent({ agent });
    },
    [agent, copilotkit],
  );
  useEffect(() => {
    const text = queued.current;
    if (!isReady || text === null) return;
    queued.current = null;
    void run(text);
  }, [isReady, run]);
  return useCallback(
    async (text: string) => {
      if (!isReady) queued.current = text;
      else await run(text);
    },
    [isReady, run],
  );
}

function RepoCard({
  repo,
  onSelect,
  testId,
}: {
  repo: RepoCardData;
  onSelect: () => void;
  testId: string;
}) {
  const [owner, name] = repo.slug.split("/");
  const { facts } = repo;
  const ci = facts?.ci ?? null;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={testId}
      className="group flex flex-col rounded-2xl border border-line bg-panel p-5 text-left shadow-[var(--rd-card-shadow)] transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--rd-input-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0"
    >
      <div className="flex items-center gap-3">
        {facts ? (
          <Image
            src={facts.avatarUrl}
            alt=""
            width={40}
            height={40}
            className="size-10 flex-none rounded-lg ring-1 ring-line"
          />
        ) : (
          <span
            className="flex size-10 flex-none items-center justify-center rounded-lg bg-tint-2 text-[17px] font-semibold text-dim ring-1 ring-line"
            aria-hidden
          >
            {owner?.[0]?.toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[17px] leading-tight">
            <span className="text-dim">{owner}/</span>
            <span className="font-semibold">{name}</span>
          </p>
          {facts && (
            <p className="mt-1 flex items-center gap-3 text-[14px] text-faint">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Star className="size-3.5" aria-hidden />
                {formatStars(facts.stars)}
              </span>
              {facts.language && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full bg-faint/60"
                    aria-hidden
                  />
                  {facts.language}
                </span>
              )}
            </p>
          )}
        </div>
      </div>
      {ci && (
        <div className="mt-4">
          <span
            className={cn(
              "inline-flex w-fit items-center gap-2 rounded-full px-2.5 py-1 text-[14px] font-medium ring-1 ring-inset",
              ci.state === "failing"
                ? "bg-fail/10 text-fail ring-fail/25"
                : "bg-pass/10 text-pass ring-pass/25",
            )}
          >
            <span className="size-2 rounded-full bg-current" aria-hidden />
            {ci.state === "failing" ? "CI failing" : "CI passing"}
          </span>
          <p className="mt-2 line-clamp-2 text-[14px] text-faint">
            {ci.state === "failing"
              ? `${ci.workflow}${ci.failingWorkflows > 1 ? ` and ${ci.failingWorkflows - 1} more` : ""}, red ${repo.redFor ?? ""}`
              : `${ci.workflows} workflow${ci.workflows === 1 ? "" : "s"} green on ${facts?.defaultBranch ?? "the default branch"}`}
          </p>
        </div>
      )}
      <p className="mt-auto border-t border-line pt-4 text-[17px] text-text transition-colors group-hover:text-accent [&:not(:first-child)]:mt-4">
        {repo.label}
      </p>
    </button>
  );
}

// The welcome screen is a component CopilotChat renders, so the cards reach it
// through context rather than props.
const ReposContext = createContext<readonly RepoCardData[]>([]);

function Welcome({ input }: { input: React.ReactElement }) {
  const send = useSend();
  const repos = useContext(ReposContext);
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 sm:px-6">
        {/* my-auto centers without clipping the top when the cards overflow. */}
        <div className="mx-auto my-auto w-full max-w-[680px] py-6">
          <h1 className="text-[30px] font-semibold sm:text-[36px] leading-tight tracking-tight text-balance">
            Why is your CI failing?
          </h1>
          <p className="mt-2 text-[17px] text-dim">
            Repo Doctor finds why GitHub CI fails, fixes it and asks before
            anything risky. Pick a repo or name any public one.
          </p>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            {repos.map((repo, index) => (
              <RepoCard
                key={repo.slug}
                repo={repo}
                onSelect={() => void send(repo.prompt)}
                testId={
                  index === 0 ? "example-prompt" : "example-prompt-secondary"
                }
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex-none">{input}</div>
    </div>
  );
}

/** A plain sentence for a failed run; the raw message is often a bare "fetch failed". */
function describeRunError(message: string): string {
  if (/runner connection (dropped|lost|closed)/i.test(message)) {
    return "The agent restarted, so this conversation's workspace and session are gone. Start a new conversation.";
  }
  if (/fetch failed|ECONNREFUSED|Failed to fetch/i.test(message)) {
    return "Lost the connection mid-run. Check your internet and send the message again.";
  }
  if (
    /Thread history lookup failed|Intelligence platform error 5\d\d/i.test(
      message,
    )
  ) {
    return "Could not load this conversation's history from CopilotKit Intelligence (the service returned an error). Send your message again.";
  }
  return `The run stopped with an error: ${message.slice(0, 240)}`;
}

export function ChatPanel({ repos }: { repos: readonly RepoCardData[] }) {
  const [error, setError] = useState<string | null>(null);
  const placeholder = usePlaceholder();
  return (
    <ReposContext.Provider value={repos}>
      <div className="chat-host relative flex min-h-0 min-w-0 flex-col bg-bg">
        {error && (
          <div
            role="alert"
            className="enter absolute top-3 left-1/2 z-30 flex w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-start gap-2.5 rounded-xl border border-fail/30 bg-panel px-3.5 py-2.5 text-[15.5px] shadow-lg"
          >
            <CircleAlert
              className="mt-0.5 size-4 flex-none text-fail"
              aria-hidden
            />
            <p className="min-w-0 flex-1 text-text/90">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss"
              className="flex-none text-faint hover:text-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}
        <CopilotChat
          onError={(event) => {
            // The prop's type also admits the DOM onError of the chat's root div.
            if ("error" in event && event.error instanceof Error) {
              setError(describeRunError(event.error.message));
            }
          }}
          agentId={AGENT_ID}
          className="h-full"
          welcomeScreen={Welcome}
          // Tool cards carry the detail; a copy bar under every step is noise.
          messageView={{ assistantMessage: { toolbarVisible: false } }}
          input={{ disclaimer: "!text-[14px] !text-faint" }}
          labels={{
            chatInputPlaceholder: placeholder,
          }}
        />
      </div>
    </ReposContext.Provider>
  );
}
