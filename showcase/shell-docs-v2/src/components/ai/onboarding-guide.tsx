"use client";

import { useMemo, useState } from "react";
import {
  useAgent,
  useAgentContext,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import Link from "fumadocs-core/link";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { STACK_CHOICES } from "@/lib/docs-chat-guides";
import {
  deriveOnboardingGuide,
  onboardingGuideToMarkdown,
  type OnboardingGuide as Guide,
} from "@/lib/docs-onboarding";
import { useDocsChatSession } from "./chat-session";

export function useOnboardingGuide() {
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnMessagesChanged] });
  return useMemo(() => deriveOnboardingGuide(agent.messages), [agent.messages]);
}

export function hasOnboardingGuide(guide: Guide) {
  return Boolean(
    guide.goal ||
    guide.frontend ||
    guide.framework ||
    guide.notes.length ||
    guide.guides.length,
  );
}

/** The running record follows the same thread as the conversation. */
export function OnboardingGuideContext() {
  const guide = useOnboardingGuide();
  useAgentContext({
    description:
      "The reader's running onboarding guide. Keep relevant goals and notes when updating it; replace corrected facts. Unknown stack fields are null.",
    value: guide,
  });
  return null;
}

export function OnboardingGuide({ guide }: { guide: Guide }) {
  const session = useDocsChatSession();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const frontend = STACK_CHOICES.frontend.find(
    (item) => item.id === guide.frontend,
  )?.name;
  const framework = STACK_CHOICES.framework.find(
    (item) => item.id === guide.framework,
  )?.name;

  async function copy() {
    try {
      await navigator.clipboard.writeText(onboardingGuideToMarkdown(guide));
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Card className="h-full min-h-0 gap-0 rounded-none bg-fd-background py-0 ring-0">
      <CardHeader className="flex h-12 shrink-0 flex-row items-center justify-between gap-2 rounded-none border-b-[1px] border-fd-border px-4 py-0">
        <h2 className="text-sm font-medium">Your guide</h2>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={() => void copy()}
          aria-label="Copy your guide"
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {copyError ? (
          <p role="alert" className="text-sm">
            Couldn’t copy your guide. Try again.
          </p>
        ) : null}
        {guide.goal ? (
          <p className="text-sm leading-6 font-medium">{guide.goal}</p>
        ) : null}
        {frontend || framework ? (
          <dl className="space-y-2 text-sm">
            {frontend ? (
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Frontend</dt>
                <dd className="font-medium">{frontend}</dd>
              </div>
            ) : null}
            {framework ? (
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Agent</dt>
                <dd className="font-medium">{framework}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {guide.notes.length ? (
          <section aria-label="Onboarding notes" className="space-y-3">
            <h3 className="text-sm font-medium">Notes</h3>
            {guide.notes.map((note, index) => (
              <div key={`${note.title}-${index}`} className="space-y-1">
                <h4 className="text-sm font-medium">{note.title}</h4>
                <p className="text-sm leading-6 text-muted-foreground">
                  {note.detail}
                </p>
              </div>
            ))}
          </section>
        ) : null}
        {guide.guides.length ? (
          <section aria-label="Collected guides" className="space-y-2">
            <h3 className="text-sm font-medium">Docs for your project</h3>
            <ItemGroup className="gap-2">
              {guide.guides.map((link) => (
                <Item
                  key={link.url}
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  render={
                    <Link
                      href={link.url}
                      onClick={() => session?.followLink()}
                    />
                  }
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle className="line-clamp-none text-sm">
                      {link.title}
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <ArrowUpRight
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
