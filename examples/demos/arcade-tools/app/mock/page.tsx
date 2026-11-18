import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArcadeWordmark } from "@/components/arcade-wordmark";
import {
  AuthorizationCard,
  EmailListCard,
  EmailSentCard,
  ErrorCard,
  GenericToolCard,
  LoadingCard,
  NewsCard,
} from "@/components/tool-cards";
import type { Email, NewsStory } from "@/components/tool-cards";

export const metadata: Metadata = {
  title: "Mock preview · Arcade × CopilotKit",
  description:
    "Static preview of the generative UI cards. No API keys, runtime, or agent required.",
};

/* -------------------------------------------------------------------------- */
/*  Sample data (fake, for visual preview only)                              */
/* -------------------------------------------------------------------------- */

const SAMPLE_NEWS: NewsStory[] = [
  {
    title: "Open-source AI agents cross the chasm into production",
    source: "TechCrunch",
    link: "https://techcrunch.com/",
  },
  {
    title: "Why per-user OAuth is the missing piece for agent tools",
    source: "The New Stack",
    link: "https://thenewstack.io/",
  },
  {
    title: "Generative UI: when the chat renders the app",
    source: "Ars Technica",
    link: "https://arstechnica.com/",
  },
];

const SAMPLE_EMAILS: Email[] = [
  {
    subject: "Your weekly agent digest",
    from: "digest@arcade.dev",
    snippet: "3 new toolkits, 2 launches, and a gateway you'll want to try…",
  },
  {
    subject: "Re: Demo feedback",
    from: "sam@example.com",
    snippet: "Loved the Connect card flow. Can we show it at the meetup?",
  },
  {
    subject: "Invoice #1042 paid",
    from: "billing@openai.com",
    snippet: "Thanks! Your payment of $-- was received.",
  },
];

/* -------------------------------------------------------------------------- */
/*  Chat scaffolding (presentational only)                                    */
/* -------------------------------------------------------------------------- */

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
        {children}
      </div>
    </div>
  );
}

function AssistantText({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-violet-600">Assistant</span>
      <p className="max-w-[90%] text-sm leading-relaxed text-zinc-700">
        {children}
      </p>
    </div>
  );
}

function CardRow({ children }: { children: ReactNode }) {
  return <div className="max-w-[92%]">{children}</div>;
}

function GalleryItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function MockPage() {
  return (
    <div className="min-h-full bg-[radial-gradient(120%_120%_at_50%_-10%,#ede9fe_0%,#f8fafc_45%,#ffffff_100%)] text-zinc-900">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ArcadeWordmark className="h-5 w-auto text-zinc-900" />
            <span className="text-sm font-semibold tracking-tight text-zinc-400">
              × CopilotKit
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm font-medium text-zinc-500">
            <Link href="/" className="transition-colors hover:text-zinc-900">
              Live demo
            </Link>
            <a
              href="https://docs.arcade.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-zinc-900"
            >
              Arcade docs
            </a>
          </nav>
        </header>

        <div className="mt-10 lg:mt-14">
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
            Static preview · fake data · no agent
          </span>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight text-zinc-900 sm:text-5xl">
            What the{" "}
            <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
              generative UI
            </span>{" "}
            looks like
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-zinc-600">
            A scripted run-through of the cards CopilotKit renders from Arcade
            tool calls, so you can see the design without keys, the runtime, or
            OAuth. The{" "}
            <Link
              href="/"
              className="font-medium text-violet-700 underline-offset-2 hover:underline"
            >
              live demo
            </Link>{" "}
            is the real thing.
          </p>
        </div>

        <main className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Scripted conversation */}
          <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5">
            <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="ml-2 text-xs font-medium text-zinc-400">
                Assistant, powered by Arcade tools
              </span>
            </div>

            <div className="space-y-5 p-4 sm:p-5">
              <UserBubble>
                Find the latest news on open-source AI agents and email me a
                3-bullet summary.
              </UserBubble>

              <AssistantText>On it, searching the news first.</AssistantText>
              <CardRow>
                <NewsCard
                  keywords="open-source AI agents"
                  stories={SAMPLE_NEWS}
                />
              </CardRow>

              <AssistantText>
                Got three good ones. To email them I need to connect your Gmail:
              </AssistantText>
              <CardRow>
                <AuthorizationCard
                  provider="Gmail"
                  authUrl="https://www.arcade.dev"
                />
              </CardRow>

              <UserBubble>Done, go ahead.</UserBubble>

              <CardRow>
                <LoadingCard label="Sending email to you@example.com…" />
              </CardRow>

              <AssistantText>
                Sent! Here&rsquo;s the summary in your inbox.
              </AssistantText>
              <CardRow>
                <EmailSentCard
                  recipient="you@example.com"
                  subject="3 stories on open-source AI agents"
                />
              </CardRow>
            </div>
          </section>

          {/* Component gallery */}
          <section className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
                Every card variant
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                The same components the chat renders, shown with sample data.
              </p>
            </div>

            <GalleryItem label="Authorization (the headline moment)">
              <AuthorizationCard
                provider="Gmail"
                authUrl="https://www.arcade.dev"
              />
            </GalleryItem>

            <GalleryItem label="Email sent">
              <EmailSentCard
                recipient="taylor@example.com"
                subject="Hello from my agent"
              />
            </GalleryItem>

            <GalleryItem label="Inbox">
              <EmailListCard emails={SAMPLE_EMAILS} />
            </GalleryItem>

            <GalleryItem label="News results">
              <NewsCard keywords="agent infrastructure" stories={SAMPLE_NEWS} />
            </GalleryItem>

            <GalleryItem label="Loading">
              <LoadingCard label="Reading your inbox…" />
            </GalleryItem>

            <GalleryItem label="Error">
              <ErrorCard message="Gmail authorization was revoked. Reconnect and try again." />
            </GalleryItem>

            <GalleryItem label="Generic fallback">
              <GenericToolCard name="Slack.SendMessage" done />
            </GalleryItem>
          </section>
        </main>
      </div>
    </div>
  );
}
