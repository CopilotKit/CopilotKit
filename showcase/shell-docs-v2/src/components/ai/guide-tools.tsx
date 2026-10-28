"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "fumadocs-core/link";
import { ArrowUpRight, Check } from "lucide-react";
import {
  useAgentContext,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  DOCS_CHAT_GUIDES,
  STACK_CHOICES,
  guideRequestSchema,
  resolveDocsGuideRequest,
} from "@/lib/docs-chat-guides";
import { useDocsChatSession } from "./chat-session";

const choiceSchema = z.object({
  kind: z.enum(["frontend", "framework"]),
  choices: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe("Two to six IDs from the available stack choices in context."),
});

/** The tool stays registered when a recommendation takes the reader into docs. */
export function DocsGuideTools() {
  const pathname = usePathname();
  const session = useDocsChatSession();
  useAgentContext({
    description:
      "Current site location and available guide IDs and stack choices. The homepage has no docs sidebar. A choice is not made until the reader supplies it.",
    value: { pathname, guides: DOCS_CHAT_GUIDES, stackChoices: STACK_CHOICES },
  });

  useHumanInTheLoop({
    name: "choose_docs_stack",
    description:
      "Ask one short stack question with buttons before recommending setup guides. Use only when that detail is missing and changes the answer. The reader can skip it.",
    parameters: choiceSchema,
    render: ({ args, status, result, respond }) => {
      if (status === "inProgress") return null;
      const choices = STACK_CHOICES[args.kind].filter((item) =>
        args.choices.includes(item.id),
      );
      return (
        <StackChoice
          kind={args.kind}
          choices={choices}
          result={result}
          respond={respond}
        />
      );
    },
  });

  useRenderTool(
    {
      name: "recommend_guides",
      parameters: guideRequestSchema,
      render: ({ parameters, status, result }) => {
        if (status !== "complete" || !result) return null;
        // Render only server-confirmed IDs, deriving every destination locally.
        let confirmed: unknown;
        try {
          confirmed = JSON.parse(result);
        } catch {
          return null;
        }
        if (!Array.isArray(confirmed)) return null;
        const request = guideRequestSchema.safeParse(parameters);
        if (!request.success) return null;
        const ids = new Set(
          confirmed.map((item: unknown) =>
            item && typeof item === "object" && "id" in item ? item.id : null,
          ),
        );
        const guides = resolveDocsGuideRequest(request.data).filter((guide) =>
          ids.has(guide.id),
        );
        if (!guides.length) return null;
        return (
          <ItemGroup
            role="group"
            className="my-3 gap-2"
            aria-label="Recommended guides"
          >
            {guides.map((guide) => (
              <Item
                key={guide.id}
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={guide.url}
                    onClick={() => session?.followLink()}
                  />
                }
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-none">
                    {guide.title}
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none text-xs">
                    {guide.description}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ArrowUpRight
                    aria-hidden
                    className="size-4 text-fd-muted-foreground"
                  />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        );
      },
    },
    [session],
  );
  return null;
}

function StackChoice({
  kind,
  choices,
  result,
  respond,
}: {
  kind: "frontend" | "framework";
  choices: { id: string; name: string }[];
  result: string | undefined;
  respond: ((result: unknown) => Promise<void>) | undefined;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  let selected: string | undefined;
  try {
    selected = result ? JSON.parse(result)?.selection : undefined;
  } catch {
    /* Older tool output may be plain text. */
  }
  if (!respond) {
    return result ? (
      <p className="my-2 flex items-center gap-1.5 text-xs text-fd-muted-foreground">
        <Check aria-hidden className="size-3.5" />
        {choices.find((choice) => choice.id === selected)?.name ??
          "Continue without a stack choice"}
      </p>
    ) : null;
  }
  const choose = async (selection: string | null) => {
    setSubmitting(true);
    setError(false);
    try {
      await respond({ kind, selection });
    } catch {
      setError(true);
      setSubmitting(false);
    }
  };
  return (
    <fieldset
      className="my-3 rounded-lg border border-fd-border p-3"
      disabled={submitting}
    >
      <legend className="px-1 text-sm font-medium">
        {kind === "frontend"
          ? "What are you building with?"
          : "Which agent framework do you use?"}
      </legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <Button
            key={choice.id}
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => void choose(choice.id)}
          >
            {choice.name}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={() => void choose(null)}
        >
          Other / not sure yet
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs">
          Couldn’t send your choice. Try again.
        </p>
      ) : null}
    </fieldset>
  );
}
