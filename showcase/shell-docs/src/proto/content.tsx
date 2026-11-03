"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/spacious/page";
import { DemoFrame } from "@/components/demo-frame";
import { Feedback } from "@/components/feedback/client";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import { sendPageFeedback } from "@/lib/feedback";
import {
  INTELLIGENCE_PAGES,
  TOPIC_SUMMARY,
  frameworkById,
  frontendById,
  topicBySlug,
  type TopicSlug,
} from "./data";
import {
  Code,
  featureSnippet,
  installCommand,
  providerSnippet,
  runtimeSnippet,
} from "./code";
import { useFrontend } from "./frontend";
import {
  AvailableTiles,
  DirectoryCards,
  FrameworkChooser,
  FrontendChips,
  FrontendMenu,
  IntelligenceCallout,
  PartnerHeader,
  PlainSentence,
  QuickstartCards,
  TwoQuestions,
} from "./pieces";
import { INTELLIGENCE_NAV, findNavTitle, navForFramework } from "./nav-d";
import { sectionHref, type Location, type VariantId } from "./routes";
import examples from "./examples.json";

/* ---------- frontend-aware code ---------- */

function ForLabel() {
  const { frontend } = useFrontend();
  return (
    <p className="not-prose -mb-2 inline-flex items-center gap-1.5 text-xs text-fd-muted-foreground">
      For
      <FrontendLogo icon={frontend} size={12} />
      <span className="font-medium text-fd-foreground">
        {frontendById(frontend)?.name}
      </span>
    </p>
  );
}

function FrontendBlock({
  kind,
  topic,
  label = true,
}: {
  kind: "install" | "provider" | "feature";
  topic?: TopicSlug;
  /** Off when the page has its own frontend picker at the top. */
  label?: boolean;
}) {
  const { frontend } = useFrontend();
  let body: ReactNode;
  if (kind === "install") {
    body = <Code lang="bash" code={installCommand(frontend)} />;
  } else if (kind === "provider") {
    const s = providerSnippet(frontend);
    body = <Code lang={s.lang} title={s.title} code={s.code} />;
  } else {
    const snippet = topic ? featureSnippet(topic) : null;
    const title = "React";
    body =
      frontend === "react" && snippet ? (
        <Code title={title} code={snippet} />
      ) : (
        <>
          {snippet ? <Code title={title} code={snippet} /> : null}
          <p className="not-prose text-sm text-fd-muted-foreground">
            Shown for React. The {frontendById(frontend)?.name} version of this
            example is not in the prototype yet, and the page says so instead of
            swapping silently.
          </p>
        </>
      );
  }
  return (
    <div className="flex flex-col gap-3">
      {label ? <ForLabel /> : null}
      {body}
    </div>
  );
}

/* ---------- page bodies ---------- */

const INTROS = TOPIC_SUMMARY;

/** "your Mastra agent"; names that already end in "agent" aren't doubled. */
function agentPhrase(name: string) {
  return /agent$/i.test(name) ? name : `${name} agent`;
}

/** Each topic's live showcase demo (a feature id in examples.json). */
const TOPIC_DEMO: Partial<Record<TopicSlug, string>> = {
  quickstart: "agentic-chat",
  "generative-ui": "gen-ui-tool-based",
  "human-in-the-loop": "hitl-in-chat",
  "shared-state": "shared-state-read-write",
};

/**
 * The topic's real showcase demo, running on the reader's framework (or the
 * first framework that has it), in the docs' demo frame.
 */
function TopicDemo({
  topic,
  framework,
}: {
  topic: TopicSlug;
  framework: string;
}) {
  const feature = examples.features.find((f) => f.id === TOPIC_DEMO[topic]);
  if (!feature) return null;
  const fw = feature.frameworks.includes(framework)
    ? framework
    : feature.frameworks[0];
  const demo = (
    feature.demos as Record<
      string,
      { route: string; files: string[] } | undefined
    >
  )[fw];
  if (!demo) return null;
  const name = frameworkById(fw)?.name ?? fw;
  return (
    <DemoFrame
      src={`${examples.host.replace("{slug}", fw)}${demo.route}`}
      title={`${feature.name}, running on ${name}`}
      label={feature.name}
      sourceHref={
        demo.files[0]
          ? `${(examples.repos as Record<string, string>)[fw]}/${demo.files[0]}`
          : (examples.repos as Record<string, string>)[fw]
      }
    />
  );
}

function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id}>{children}</h2>;
}

function TopicBody({
  variant,
  framework,
  topic,
  intro,
}: {
  variant: VariantId;
  framework: string;
  topic: TopicSlug;
  /** Show the one-line intro when the page has no description. */
  intro?: boolean;
}) {
  const fw = frameworkById(framework)!;
  const label = variant !== "d";
  const { frontend } = useFrontend();
  const channel = frontendById(frontend)?.kind === "channel";
  const intelligenceHref = sectionHref(variant, "intelligence", "threads");
  if (topic === "quickstart") {
    return (
      <>
        {variant === "b" ? (
          <TwoQuestions variant={variant} framework={framework} />
        ) : null}
        <H2 id="install">Install</H2>
        <FrontendBlock kind="install" label={label} />
        {channel ? (
          <>
            <H2 id="provider">Create the channel</H2>
            <p>
              The channel runs inside your runtime and hands each message to
              your agent.
            </p>
          </>
        ) : (
          <>
            <H2 id="provider">Add the provider</H2>
            <p>
              Point the provider at your runtime. Everything under it can talk
              to your agent.
            </p>
          </>
        )}
        <FrontendBlock kind="provider" label={label} />
        <H2 id="agent">Connect your {agentPhrase(fw.name)}</H2>
        <p>The runtime passes events between your app and your agent.</p>
        <Code
          title="app/api/copilotkit/route.ts"
          lang="ts"
          code={runtimeSnippet(framework)}
        />
        <H2 id="run">Run it</H2>
        <p>
          Start your app and send a message. Your {agentPhrase(fw.name)} answers
          through the runtime.
        </p>
        <TopicDemo topic={topic} framework={framework} />
      </>
    );
  }
  return (
    <>
      {intro ? <p>{INTROS[topic]}</p> : null}
      <TopicDemo topic={topic} framework={framework} />
      <H2 id="app">In your app</H2>
      <FrontendBlock kind="feature" topic={topic} label={label} />
      {topic === "threads" || topic === "shared-state" ? (
        <IntelligenceCallout href={intelligenceHref}>
          {topic === "threads"
            ? "Threads persist with their generative UI, so users pick up where they left off."
            : "Keep state and user memories across sessions."}
        </IntelligenceCallout>
      ) : null}
      <H2 id="agent">On your {agentPhrase(fw.name)}</H2>
      <p>
        Nothing changes on the agent side beyond connecting it through the
        runtime.
      </p>
      <Code
        title="app/api/copilotkit/route.ts"
        lang="ts"
        code={runtimeSnippet(framework)}
      />
    </>
  );
}

const TOC: Record<string, { title: string; url: string; depth: number }[]> = {
  quickstart: [
    { title: "Install", url: "#install", depth: 2 },
    { title: "Add the provider", url: "#provider", depth: 2 },
    { title: "Connect your agent", url: "#agent", depth: 2 },
    { title: "Run it", url: "#run", depth: 2 },
  ],
  feature: [
    { title: "In your app", url: "#app", depth: 2 },
    { title: "On your agent", url: "#agent", depth: 2 },
  ],
};

const TOPIC_SUMMARY_INTELLIGENCE =
  "Threads that persist, user memories, and agents that learn from real use.";

const INTELLIGENCE_TEXT: Record<string, string> = {
  "": "CopilotKit Intelligence is what production agent apps add: threads that persist with their generative UI, user memories, and agents that learn from real use. It plugs into the same runtime.",
  threads:
    "Rich threads keep each conversation, its generative UI included, so a user can leave and come back to the same state.",
  memory:
    "Agents keep memories about each user and learn from real use, so the next conversation starts smarter.",
  "self-hosting":
    "Run Intelligence in your own environment, or use the hosted version.",
};

/* ---------- the article ---------- */

interface Article {
  title: string;
  description?: string;
  header?: ReactNode;
  body: ReactNode;
  toc?: { title: string; url: string; depth: number }[];
  tocFooter?: ReactNode;
}

function placeholder(title: string) {
  return (
    <p>
      A placeholder for &ldquo;{title}&rdquo; from the live docs. Its content
      moves over with the rest of the docs.
    </p>
  );
}

function buildArticle(variant: VariantId, loc: Location): Article {
  if (variant === "d" && loc.kind === "intelligence") {
    const title = loc.slug
      ? findNavTitle([{ items: INTELLIGENCE_NAV }], "intelligence", loc.slug)
      : "CopilotKit Intelligence";
    if (!title)
      return { title: "Not in the prototype", body: placeholder("this page") };
    const text = INTELLIGENCE_TEXT[loc.slug];
    return {
      title,
      description: loc.slug ? undefined : TOPIC_SUMMARY_INTELLIGENCE,
      body: text ? <p>{text}</p> : placeholder(title),
    };
  }
  if (loc.kind === "intelligence") {
    const p =
      INTELLIGENCE_PAGES.find((x) => x.slug === loc.slug) ??
      INTELLIGENCE_PAGES[0];
    return {
      title: p.slug ? p.title : "CopilotKit Intelligence",
      description:
        "Its own section, and also spliced into the docs wherever it adds value.",
      body: <p>{INTELLIGENCE_TEXT[p.slug]}</p>,
    };
  }

  if (loc.kind === "integrations") {
    return {
      title: "Integrations",
      description:
        "Pick your agent framework. Each has its own pages and live demos.",
      body:
        variant === "c" ? (
          <QuickstartCards variant={variant} />
        ) : variant === "b" ? (
          <DirectoryCards variant={variant} />
        ) : (
          <FrameworkChooser variant={variant} slug="" />
        ),
    };
  }

  if (loc.kind === "docs") {
    const topic = topicBySlug(loc.slug);
    if (!loc.slug) {
      if (variant === "b") {
        return {
          title: "Integrations",
          description:
            "Start with your agent framework. Every framework has its own guide and live demos.",
          body: <DirectoryCards variant={variant} />,
        };
      }
      if (variant === "c") {
        return {
          title: "Getting started",
          description:
            "CopilotKit connects your app to AI agents. Start with your agent framework.",
          body: (
            <>
              <H2 id="quickstarts">Agent quickstarts</H2>
              <QuickstartCards variant={variant} />
            </>
          ),
          toc: [{ title: "Agent quickstarts", url: "#quickstarts", depth: 2 }],
        };
      }
      return {
        title: "Choose your agent framework",
        description:
          "These docs are written for each agent framework. Pick yours to start.",
        body: <FrameworkChooser variant={variant} slug="quickstart" />,
      };
    }
    if (topic && variant !== "c") {
      return {
        title: topic.title,
        description: INTROS[topic.slug],
        body: <FrameworkChooser variant={variant} slug={topic.slug} />,
      };
    }
    if (topic) {
      // C: feature pages are framework-neutral; the example uses the CopilotKit agent.
      return {
        title: topic.title,
        description: INTROS[topic.slug],
        body: (
          <>
            <p className="text-sm text-fd-muted-foreground">
              The example uses the CopilotKit agent. For yours, open its{" "}
              <Link href={sectionHref(variant, "docs")}>quickstart</Link> or the{" "}
              <Link href={sectionHref(variant, "integrations")}>
                Integrations
              </Link>{" "}
              tab.
            </p>
            <TopicBody
              variant={variant}
              framework="built-in-agent"
              topic={topic.slug}
            />
          </>
        ),
        toc: topic.slug === "quickstart" ? TOC.quickstart : TOC.feature,
      };
    }
    return {
      title: "Not in the prototype",
      body: <p>This page isn&apos;t part of the prototype.</p>,
    };
  }

  if (loc.kind === "examples") {
    return { title: "Examples", body: null };
  }

  // A framework page.
  const fw = frameworkById(loc.framework)!;
  const slug = loc.slug;
  if (variant === "d" && !topicBySlug(slug)) {
    if (!slug) {
      return {
        title: fw.name,
        description: fw.summary,
        body: placeholder("Introduction"),
      };
    }
    const title = findNavTitle(navForFramework(fw), "framework", slug);
    return {
      title: title ?? "Not in the prototype",
      body: placeholder(title ?? "this page"),
    };
  }
  if (!slug) {
    if (variant === "b") {
      return {
        title: `CopilotKit for ${fw.name}`,
        body: <PartnerHeader variant={variant} framework={fw.id} />,
      };
    }
    return {
      title: fw.name,
      description: `Everything about using CopilotKit with ${fw.name}.`,
      body: <FrameworkChooser variant={variant} slug="quickstart" />,
    };
  }
  const topic = topicBySlug(slug);
  if (!topic)
    return {
      title: "Not in the prototype",
      body: <p>This page isn&apos;t part of the prototype.</p>,
    };
  const toc = topic.slug === "quickstart" ? TOC.quickstart : TOC.feature;
  const body = (
    <TopicBody variant={variant} framework={fw.id} topic={topic.slug} />
  );

  switch (variant) {
    // Sentry: the title names the framework. Storybook: frontend buttons.
    // Prisma: one sentence says what the page uses and offers the switch.
    case "a":
      return {
        title: `${topic.title} for ${fw.name}`,
        description: INTROS[topic.slug],
        header: (
          <div className="not-prose flex flex-col gap-3">
            <FrontendChips />
            <PlainSentence variant={variant} framework={fw.id} slug={slug} />
          </div>
        ),
        body,
        toc,
      };
    // Clerk: "Available for" tiles beside the page. Expo: questions on the quickstart.
    case "b":
      return {
        title: topic.title,
        description: `${INTROS[topic.slug]} With ${fw.name}.`,
        header:
          topic.slug === "quickstart" ? undefined : (
            <FrontendMenu look="button" />
          ),
        body,
        toc,
        tocFooter: (
          <AvailableTiles variant={variant} framework={fw.id} slug={slug} />
        ),
      };
    // Home first: the docs keep their current format, and guides with
    // frontend code open with a frontend picker.
    case "d":
      return {
        title:
          findNavTitle(navForFramework(fw), "framework", slug) ?? topic.title,
        description: `${INTROS[topic.slug]} With ${fw.name}.`,
        header: <FrontendChips size="sm" />,
        body,
        toc,
      };
    // Product tabs + Supabase: each framework's pages live under Integrations.
    case "c":
      return {
        title: `${topic.title} for ${fw.name}`,
        description: INTROS[topic.slug],
        body,
        toc,
      };
  }
}

export function ProtoArticle({
  variant,
  loc,
}: {
  variant: VariantId;
  loc: Location;
}) {
  const a = buildArticle(variant, loc);
  return (
    <DocsPage
      toc={a.toc ?? []}
      tableOfContent={a.tocFooter ? { footer: a.tocFooter } : undefined}
    >
      <DocsTitle className="text-[2.25rem] leading-[1.1] font-medium md:text-[2.5rem] tracking-[-0.03em] text-balance">
        {a.title}
      </DocsTitle>
      {a.description ? (
        <DocsDescription className="mb-0">{a.description}</DocsDescription>
      ) : null}
      {a.header}
      <DocsBody>{a.body}</DocsBody>
      <Feedback onSendAction={sendPageFeedback} />
    </DocsPage>
  );
}
