"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, Info } from "lucide-react";
import { EarlyAccessBadge } from "@/components/early-access/badge";
import { BookCta } from "@/components/early-access/book-cta";
import { ChannelDemoBooker } from "@/components/early-access/booker";
import { ConversationPreview } from "@/components/early-access/conversation";
import { FrontendLogo, frontendGlyph } from "@/components/icons/frontend-logo";
import {
  AgentGlyph,
  ChannelsSdkGlyph,
  IntelligenceGlyph,
} from "@/components/icons/glyphs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { frontendHref } from "@/lib/live-scope";
import type { EarlyAccessChannelId } from "@/lib/early-access/channels";
import {
  EARLY_ACCESS_CHANNEL_COPY,
  SHARED_EARLY_ACCESS_COPY,
  linkSegments,
} from "@/lib/early-access/copy";
import type { TextLink } from "@/lib/early-access/copy";
import { ChannelSwitcher } from "./channel-switcher";
import { FRONTENDS } from "./data";
import { DFooter } from "./home-d";
import { LinkCard, Tray } from "./link-card";

/** How Channels works today: the Slack guide, and the Channels overview. */
const SLACK_GUIDE = "/slack/connect";
const CHANNELS_OVERVIEW = "/slack";

const sectionTitle = "text-2xl leading-tight font-medium tracking-[-0.03em]";
/** A card standing on the page, as the home's: 12px, a hairline, a lift. */
const card = "rounded-lg border bg-card shadow-card dark:bg-[#13131b]";
/** A link inside a line of text, as the docs' prose links. */
const inlineLink =
  "rounded-sm font-medium text-primary underline decoration-[1.5px] underline-offset-[3.5px] outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none";

/** Shared lines name the channel as "{channel}". */
const fill = (text: string, name: string) => text.replaceAll("{channel}", name);

/** A line of copy with its links (`/sms` in iMessage's Android line). */
function Linked({ text, links }: { text: string; links?: TextLink[] }) {
  return linkSegments(text, links).map((segment, index) =>
    segment.href ? (
      <Link key={index} href={segment.href} className={inlineLink}>
        {segment.text}
      </Link>
    ) : (
      segment.text
    ),
  );
}

/**
 * An early-access channel's landing page (/imessage, /whatsapp, /sms, /rcs),
 * built like copilotkit.ai/clif: the pitch with the demo booker beside it, a
 * conversation in the channel's own look, what CopilotKit brings, how it
 * works, what sets the channel apart, a second way to book, and the other
 * channels. One template; the words are the channel's record in
 * src/lib/early-access/copy.ts.
 */
export function ChannelLanding({ id }: { id: EarlyAccessChannelId }) {
  const copy = EARLY_ACCESS_CHANNEL_COPY[id];
  const shared = SHARED_EARLY_ACCESS_COPY;
  const name = copy.name;
  // A frontend with no brand mark (SMS) takes the accent, as a card glyph does.
  const glyph = frontendGlyph(id);
  const stepGlyphs: ReactNode[] = [
    <FrontendLogo key="channel" icon={id} size={22} />,
    <IntelligenceGlyph key="intelligence" />,
    <ChannelsSdkGlyph key="sdk" />,
    <AgentGlyph key="agent" />,
  ];

  return (
    <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-20 px-5 pt-8 pb-24 md:gap-24 md:px-8 md:pt-12">
      <section className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-14">
        <div className="flex flex-col items-start gap-7 lg:pt-2">
          <ChannelSwitcher channel={id} />
          <div className="flex flex-col gap-5">
            <h1 className="text-[2.5rem] leading-[1.04] font-normal tracking-[-0.03em] text-balance md:text-[3.5rem]">
              {copy.hero.title}
            </h1>
            <p className="max-w-[36rem] text-lg leading-[1.5] text-muted-foreground">
              {copy.hero.lede}
            </p>
          </div>
          {/* Where the channel stands today, after its early-access badge,
              and a link to what ships now (WhatsApp's adapter). */}
          <p className="max-w-[36rem] text-sm leading-relaxed text-muted-foreground">
            <EarlyAccessBadge className="me-2" />
            {copy.status}
            {copy.statusLink ? (
              <>
                {" "}
                <Link href={copy.statusLink.href} className={inlineLink}>
                  {copy.statusLink.label}
                </Link>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <BookCta>{shared.primaryCta}</BookCta>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={SLACK_GUIDE} />}
              className="h-11 gap-2 rounded-full bg-card px-5 text-base shadow-lift dark:bg-[#1e1e2a]"
            >
              {shared.secondaryCta}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
        <ChannelDemoBooker channel={id} />
      </section>

      <div className="grid items-start gap-16 md:grid-cols-[20.5rem_minmax(0,1fr)] md:gap-12 lg:gap-20">
        <section
          aria-labelledby="channel-conversation"
          className="flex flex-col gap-6"
        >
          <h2 id="channel-conversation" className={sectionTitle}>
            {fill(shared.conversationTitle, name)}
          </h2>
          <ConversationPreview
            channel={id}
            name={name}
            contact={copy.conversation.contact}
            messages={copy.conversation.messages}
          />
        </section>
        <section
          aria-labelledby="channel-features"
          className="flex flex-col gap-6"
        >
          <h2 id="channel-features" className={sectionTitle}>
            {fill(shared.featuresTitle, name)}
          </h2>
          <ul className="flex flex-col gap-4">
            {copy.features.map((feature) => (
              <li key={feature.title} className={cn(card, "p-5 sm:p-6")}>
                <h3 className="text-base leading-6 font-semibold">
                  {feature.title}
                </h3>
                <p className="mt-1.5 leading-relaxed text-muted-foreground">
                  {feature.body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="channel-how" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-10">
          <div className="flex max-w-[44rem] flex-col gap-3">
            <h2 id="channel-how" className={sectionTitle}>
              {fill(shared.howItWorks.title, name)}
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              {fill(shared.howItWorks.lede, name)}
            </p>
            {/* Where the channel also runs another way today (WhatsApp's
                direct adapter): a quiet aside, as a docs callout. */}
            {copy.howItWorksNote ? (
              <p className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <Info
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-primary"
                />
                {copy.howItWorksNote}
              </p>
            ) : null}
          </div>
          <Link
            href={CHANNELS_OVERVIEW}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Read the Channels overview
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <ol className="grid gap-7 md:grid-cols-2 md:gap-4 lg:grid-cols-4 lg:gap-8">
          {shared.howItWorks.steps.map((step, index, steps) => (
            <li
              key={step.title}
              className={cn(card, "relative flex flex-col gap-3 p-5")}
            >
              <span
                aria-hidden="true"
                className="flex size-6 items-center text-primary [&_svg]:size-[22px]"
              >
                {stepGlyphs[index]}
              </span>
              <h3 className="leading-6 font-semibold">
                {fill(step.title, name)}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {fill(step.body, name)}
              </p>
              {index < steps.length - 1 ? (
                // The path a message takes: down the steps on a phone, across
                // them on wide screens (in two columns it would mislead).
                <>
                  <ArrowDown
                    aria-hidden="true"
                    className="absolute -bottom-[1.375rem] left-1/2 size-4 -translate-x-1/2 text-muted-foreground md:hidden"
                  />
                  <ArrowRight
                    aria-hidden="true"
                    className="absolute top-1/2 -right-6 hidden size-4 -translate-y-1/2 text-muted-foreground lg:block"
                  />
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="channel-specifics"
        className="flex flex-col gap-8"
      >
        <h2 id="channel-specifics" className={sectionTitle}>
          {fill(shared.specificsTitle, name)}
        </h2>
        <ul className="grid gap-8 md:grid-cols-3">
          {copy.specifics.map((fact) => (
            <li key={fact.title} className="flex flex-col gap-2 border-t pt-5">
              <h3 className="leading-6 font-semibold">{fact.title}</h3>
              <p className="leading-relaxed text-muted-foreground">
                <Linked text={fact.body} links={fact.links} />
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="channel-closing"
        className="flex flex-col items-center gap-5 rounded-2xl border bg-card px-6 py-14 text-center shadow-card md:py-16 dark:bg-[#13131b]"
      >
        <span
          aria-hidden="true"
          className={cn(glyph === "ink" && "text-primary")}
        >
          <FrontendLogo icon={id} size={36} />
        </span>
        {/* Display small: the light display voice, one step down. */}
        <h2
          id="channel-closing"
          className="max-w-[38rem] text-[2.5rem] leading-[1.04] font-normal tracking-[-0.03em] text-balance"
        >
          {copy.closing.title}
        </h2>
        <p className="max-w-[34rem] text-lg leading-[1.5] text-muted-foreground">
          {copy.closing.body}
        </p>
        <BookCta className="mt-2">{shared.primaryCta}</BookCta>
      </section>

      <section aria-labelledby="channel-others" className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 id="channel-others" className={sectionTitle}>
            {shared.otherChannelsTitle}
          </h2>
          <p className="text-muted-foreground">{shared.gaChannelsNote}</p>
        </div>
        <Tray variant="bare">
          {/* The other channels, those in early access first. */}
          {FRONTENDS.filter((f) => f.kind === "channel" && f.id !== id)
            .sort((a, b) => Number(!!b.earlyAccess) - Number(!!a.earlyAccess))
            .map((f) => (
              <LinkCard
                key={f.id}
                href={frontendHref([], f.id, "")}
                glyph={frontendGlyph(f.id)}
                icon={<FrontendLogo icon={f.id} size={22} />}
                title={f.name}
                description={f.summary}
                badge={f.earlyAccess ? <EarlyAccessBadge /> : undefined}
              />
            ))}
        </Tray>
      </section>

      <DFooter />
    </div>
  );
}
