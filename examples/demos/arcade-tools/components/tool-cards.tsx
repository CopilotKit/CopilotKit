import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/*  Result parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `useRenderTool` hands `result` back as a JSON string once the tool finishes.
 * This helper parses it (and tolerates an already-parsed object, just in case).
 */
export function parseResult<T>(result: unknown): T | undefined {
  if (result == null) return undefined;
  if (typeof result === "object") return result as T;
  if (typeof result === "string") {
    if (result.length === 0) return undefined;
    try {
      return JSON.parse(result) as T;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export type ArcadeResult =
  | {
      authorizationRequired: true;
      provider: string;
      toolName: string;
      authUrl: string;
    }
  | {
      authorizationRequired: false;
      provider: string;
      toolName: string;
      output: unknown;
    }
  | { error: string; toolName: string };

export type NewsStory = { source?: string; title?: string; link?: string };
export type Email = {
  from?: string;
  sender?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  date?: string;
};

export function extractNews(output: unknown): NewsStory[] {
  if (Array.isArray(output)) return output as NewsStory[];
  const value = output as { news_results?: NewsStory[] } | null;
  return value?.news_results ?? [];
}

export function extractEmails(output: unknown): Email[] {
  if (Array.isArray(output)) return output as Email[];
  const value = output as { emails?: Email[]; messages?: Email[] } | null;
  return value?.emails ?? value?.messages ?? [];
}

/* -------------------------------------------------------------------------- */
/*  Icons (inline, no extra deps)                                            */
/* -------------------------------------------------------------------------- */

type IconProps = { className?: string };

const Icon = ({
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

const LockIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);
const CheckIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
const InboxIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  </Icon>
);
const NewsIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
    <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6Z" />
  </Icon>
);
const AlertIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Icon>
);
const SparkIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </Icon>
);
const ArrowIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </Icon>
);

/* -------------------------------------------------------------------------- */
/*  Card primitives                                                           */
/* -------------------------------------------------------------------------- */

type Accent = "violet" | "emerald" | "sky" | "zinc" | "red";

const accentRing: Record<Accent, string> = {
  violet: "border-violet-200 bg-violet-50/60",
  emerald: "border-emerald-200 bg-emerald-50/60",
  sky: "border-sky-200 bg-sky-50/60",
  zinc: "border-zinc-200 bg-zinc-50/60",
  red: "border-red-200 bg-red-50/60",
};
const accentChip: Record<Accent, string> = {
  violet: "bg-violet-600 text-white",
  emerald: "bg-emerald-600 text-white",
  sky: "bg-sky-600 text-white",
  zinc: "bg-zinc-700 text-white",
  red: "bg-red-600 text-white",
};

function ToolCard({
  accent,
  icon,
  title,
  badge,
  children,
}: {
  accent: Accent;
  icon: ReactNode;
  title: string;
  badge?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`w-full rounded-2xl border p-4 shadow-sm ${accentRing[accent]}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${accentChip[accent]}`}
        >
          <span className="h-5 w-5">{icon}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {title}
          </p>
        </div>
        {badge && (
          <span className="shrink-0 rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
            {badge}
          </span>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Cards                                                                     */
/* -------------------------------------------------------------------------- */

export function LoadingCard({ label }: { label: string }) {
  return (
    <ToolCard
      accent="zinc"
      icon={<SparkIcon className="h-5 w-5 animate-pulse" />}
      title={label}
    >
      <div className="space-y-2">
        <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-200" />
      </div>
    </ToolCard>
  );
}

/**
 * Only ever link to a real http(s) URL, never an attacker-controlled scheme
 * (javascript:, data:, etc.). Tool results flow from external services through the
 * model into href attributes, so every link (auth URLs AND news links) goes through this.
 */
function safeHttpUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/** The star of the cookbook: rendered when Arcade needs the user to connect. */
export function AuthorizationCard({
  provider,
  authUrl,
}: {
  provider: string;
  authUrl: string;
}) {
  const href = safeHttpUrl(authUrl);
  return (
    <ToolCard
      accent="violet"
      icon={<LockIcon className="h-5 w-5" />}
      title={`Connect ${provider}`}
      badge="Authorization"
    >
      <p className="text-sm text-zinc-600">
        Arcade needs you to authorize{" "}
        <span className="font-medium">{provider}</span> once. Your credentials
        are vaulted by Arcade and never shared with the model.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            Connect {provider}
            <ArrowIcon className="h-4 w-4" />
          </a>
        ) : (
          <span className="text-sm font-medium text-red-600">
            Authorization link unavailable. Please try again.
          </span>
        )}
        <span className="text-xs text-zinc-500">
          Opens in a new tab. Come back when you&rsquo;re done and say
          &ldquo;continue&rdquo;.
        </span>
      </div>
    </ToolCard>
  );
}

export function EmailSentCard({
  recipient,
  subject,
}: {
  recipient?: string;
  subject?: string;
}) {
  return (
    <ToolCard
      accent="emerald"
      icon={<CheckIcon className="h-5 w-5" />}
      title="Email sent"
      badge="Gmail"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-zinc-500">To</dt>
        <dd className="truncate font-medium text-zinc-800">
          {recipient || "-"}
        </dd>
        <dt className="text-zinc-500">Subject</dt>
        <dd className="truncate font-medium text-zinc-800">{subject || "-"}</dd>
      </dl>
    </ToolCard>
  );
}

export function EmailListCard({ emails }: { emails: Email[] }) {
  return (
    <ToolCard
      accent="zinc"
      icon={<InboxIcon className="h-5 w-5" />}
      title={`Inbox: ${emails.length} ${emails.length === 1 ? "email" : "emails"}`}
      badge="Gmail"
    >
      {emails.length === 0 ? (
        <p className="text-sm text-zinc-500">No emails found.</p>
      ) : (
        <ul className="divide-y divide-zinc-200">
          {emails.slice(0, 8).map((email, i) => (
            <li key={i} className="py-2 first:pt-0 last:pb-0">
              <p className="truncate text-sm font-medium text-zinc-800">
                {email.subject || "(no subject)"}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {email.from || email.sender || "Unknown sender"}
                {email.snippet ? (
                  <span className="text-zinc-400">{` ${email.snippet}`}</span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}

export function NewsCard({
  keywords,
  stories,
}: {
  keywords?: string;
  stories: NewsStory[];
}) {
  return (
    <ToolCard
      accent="sky"
      icon={<NewsIcon className="h-5 w-5" />}
      title={keywords ? `News: “${keywords}”` : "News results"}
      badge="Google News"
    >
      {stories.length === 0 ? (
        <p className="text-sm text-zinc-500">No stories found.</p>
      ) : (
        <ul className="space-y-2">
          {stories.slice(0, 6).map((story, i) => {
            const href = safeHttpUrl(story.link);
            const inner = (
              <>
                <p className="line-clamp-2 text-sm font-medium text-sky-900">
                  {story.title || "Untitled"}
                </p>
                {story.source && (
                  <p className="mt-0.5 text-xs text-zinc-500">{story.source}</p>
                )}
              </>
            );
            return (
              <li key={i}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg p-2 transition-colors hover:bg-white/70"
                  >
                    {inner}
                  </a>
                ) : (
                  <div className="block rounded-lg p-2">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ToolCard>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <ToolCard
      accent="red"
      icon={<AlertIcon className="h-5 w-5" />}
      title="Something went wrong"
      badge="Error"
    >
      <p className="break-words text-sm text-red-700">{message}</p>
    </ToolCard>
  );
}

export function GenericToolCard({
  name,
  done,
}: {
  name: string;
  done: boolean;
}) {
  return (
    <ToolCard
      accent="zinc"
      icon={<SparkIcon className="h-5 w-5" />}
      title={name}
      badge={done ? "Done" : "Running…"}
    />
  );
}
