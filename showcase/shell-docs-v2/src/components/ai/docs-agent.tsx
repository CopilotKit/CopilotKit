"use client";

import { useMemo, type ReactNode } from "react";
import {
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import Link from "fumadocs-core/link";
import { flattenTree } from "fumadocs-core/page-tree";
import { useTreeContext, useTreePath } from "fumadocs-ui/contexts/tree";
import { useSpaciousLayout } from "fumadocs-ui/layouts/spacious";
import { usePathname, useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { z } from "zod";
import { Spinner } from "@/components/ui/spinner";

// Below this width Spacious floats the chat over the page, so opening a page
// closes the chat to show it.
export const SIDE_BY_SIDE = "(min-width: 80rem)";

const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  list_pages: ["Listing the pages", "Listed the pages"],
  search_pages: ["Searching these docs", "Searched these docs"],
  get_page: ["Reading", "Read"],
  "search-docs": [
    "Searching the CopilotKit docs",
    "Searched the CopilotKit docs",
  ],
  "search-code": [
    "Searching the CopilotKit source",
    "Searched the CopilotKit source",
  ],
  "search-ag-ui-docs": ["Searching the AG-UI docs", "Searched the AG-UI docs"],
  "search-ag-ui-code": [
    "Searching the AG-UI source",
    "Searched the AG-UI source",
  ],
  // Generative UI in the chat; the full-page chat's guide has its own.
  render_ui: ["Drawing the answer", "Drew the answer"],
};

const GUIDE_LABELS: [running: string, done: string] = [
  "Writing your guide",
  "Wrote your guide",
];

/**
 * One quiet line per tool call: a mint spinner while it runs (mint is the
 * live voice), a check once it's done, and what it looked up in mono.
 */
function ToolStatus({
  done,
  detail,
  children,
}: {
  done: boolean;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <p className="my-1.5 flex min-w-0 items-center gap-1.5 text-xs leading-5 text-fd-muted-foreground">
      {done ? (
        <Check aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <Spinner
          aria-hidden
          className="size-3.5 shrink-0 text-brand-mint-deep dark:text-brand-mint"
        />
      )}
      <span className="shrink-0">{children}</span>
      {detail ? (
        <span className="min-w-0 truncate font-mono text-xs text-fd-muted-foreground/80">
          {detail}
        </span>
      ) : null}
    </p>
  );
}

/**
 * The agent's server and MCP tools: one quiet status line each, folded into
 * the reply's "Worked for" row with the rest of the work. The docs' side
 * chat and the full-page chat both draw them.
 */
export function useToolStatus() {
  useRenderTool({
    name: "*",
    group: true,
    render: ({ name, parameters, status }) => {
      const [running, done] =
        name === "render_ui" && parameters?.target === "guide"
          ? GUIDE_LABELS
          : (TOOL_LABELS[name] ?? ["Working", "Done"]);
      const detail = parameters?.query ?? parameters?.url;
      return (
        <ToolStatus
          done={status === "complete"}
          detail={typeof detail === "string" ? detail : undefined}
        >
          {status === "complete" ? done : `${running}…`}
        </ToolStatus>
      );
    },
  });
}

/**
 * Gives the "Ask AI" agent the reader's page and the sidebar, and lets it
 * open pages. Renders nothing; it sits inside the docs layout so it can read
 * the page tree, whichever tree the layout was given.
 */
export function DocsAgent() {
  const router = useRouter();
  const pathname = usePathname();
  const { full: tree } = useTreeContext();
  const page = useTreePath().at(-1);
  const pageTitle =
    page?.type === "page" && typeof page.name === "string" ? page.name : null;
  const { props } = useSpaciousLayout();
  const setChatOpen = props.aiChat?.onOpenChange;

  const sidebarPages = useMemo(
    () =>
      flattenTree(tree.children)
        .filter((item) => !item.external)
        .map((item) => ({
          title: typeof item.name === "string" ? item.name : null,
          url: item.url,
        })),
    [tree],
  );

  useAgentContext({
    description: "The docs page the reader is on",
    value: { url: pathname, title: pageTitle },
  });

  useAgentContext({
    description:
      "The pages in the docs sidebar; open_page can open any of them",
    value: sidebarPages,
  });

  useFrontendTool(
    {
      name: "open_page",
      description:
        "Open a page in the docs sidebar for the reader, optionally at a section.",
      parameters: OPEN_PAGE_PARAMS,
      handler: async ({ url, heading }) => {
        const path = url.split("#")[0];
        if (!sidebarPages.some((p) => p.url === path)) {
          return `${url} is not in the docs sidebar. Pick a URL from the sidebar pages.`;
        }
        router.push(heading ? `${path}#${heading}` : path);
        if (!window.matchMedia(SIDE_BY_SIDE).matches) setChatOpen?.(false);
        return `Opened ${path} for the reader.`;
      },
    },
    [sidebarPages, router, setChatOpen],
  );

  // Drawn by a renderer rather than the tool, since only a renderer can join
  // the reply's "Worked for" row (`group`); a tool's own render stays apart.
  useRenderTool({
    name: "open_page",
    parameters: OPEN_PAGE_PARAMS,
    group: true,
    render: ({ parameters, status }) => (
      <ToolStatus done={status === "complete"}>
        {status === "complete" && parameters?.url ? (
          <>
            Opened{" "}
            <Link
              href={parameters.url}
              className="font-medium text-fd-primary underline-offset-2 hover:underline"
            >
              {parameters.title ?? parameters.url}
            </Link>
          </>
        ) : (
          "Opening a page"
        )}
      </ToolStatus>
    ),
  });

  useToolStatus();

  // The empty chat's four suggestions (drawn as cards by ChatSuggestions);
  // each one sends its message. The agent already has the reader's stack.
  useConfigureSuggestions(
    {
      available: "before-first-message",
      suggestions: [
        {
          title: "Explain this page",
          message: pageTitle
            ? `Explain the “${pageTitle}” page in a few lines.`
            : "What is CopilotKit, in a few lines?",
        },
        {
          title: "Set up my stack",
          message: "Walk me through adding CopilotKit to my app, on my stack.",
        },
        {
          title: "Open the quickstart",
          message: "Open the quickstart for me.",
        },
        {
          title: "How AG-UI works",
          message: "How does AG-UI connect my app to my agent? Keep it short.",
        },
      ],
    },
    [pageTitle],
  );

  return null;
}

/** open_page's arguments, shared by the tool and its renderer. */
const OPEN_PAGE_PARAMS = z.object({
  url: z.string().describe("The page URL, from the sidebar pages"),
  title: z.string().describe("The page title, shown to the reader"),
  heading: z
    .string()
    .optional()
    .describe("A heading id on the page to scroll to, like install"),
});

/** set_stack's arguments as its renderer reads them (the tool's are enums). */
const SET_STACK_PARAMS = z.object({
  frontend: z.string(),
  agentFramework: z.string(),
});

interface Choice {
  id: string;
  name: string;
}

/**
 * The reader's stack for the agent, and a tool to switch it. Each layout
 * says where its stack lives (see `stack-agents.tsx`).
 */
export function StackAgent({
  frontend,
  agentFramework,
  frontends,
  frameworks,
  onSwitch,
}: {
  /** Ids, or null until the reader picks one. */
  frontend: string | null;
  agentFramework: string | null;
  frontends: readonly Choice[];
  frameworks: readonly Choice[];
  /** Switches the stack; returns what happened, for the agent. Keep it stable. */
  onSwitch: (frontend: string, agentFramework: string) => string;
}) {
  const fe = frontends.find((c) => c.id === frontend) ?? null;
  const fw = frameworks.find((c) => c.id === agentFramework) ?? null;

  useAgentContext({
    description:
      "The reader's stack: the frontend and agent framework the docs' code samples follow. null where they haven't picked one.",
    value: { frontend: fe?.name ?? null, agentFramework: fw?.name ?? null },
  });

  const nameOf = (list: readonly Choice[], id?: string) =>
    list.find((c) => c.id === id)?.name ?? id;

  useFrontendTool(
    {
      name: "set_stack",
      description:
        "Switch the reader's stack, so every code sample on the docs follows their frontend and agent framework.",
      parameters: z.object({
        frontend: z.enum(frontends.map((f) => f.id) as [string, ...string[]]),
        agentFramework: z
          .enum(frameworks.map((f) => f.id) as [string, ...string[]])
          .describe("The agent framework id"),
      }),
      handler: async ({ frontend, agentFramework }) =>
        onSwitch(frontend, agentFramework),
    },
    [frontends, frameworks, onSwitch],
  );

  // Its status line joins the reply's "Worked for" row (see open_page).
  useRenderTool(
    {
      name: "set_stack",
      parameters: SET_STACK_PARAMS,
      group: true,
      render: ({ parameters, status }) => (
        <ToolStatus done={status === "complete"}>
          {status === "complete" &&
          parameters?.frontend &&
          parameters?.agentFramework
            ? `Switched to ${nameOf(frontends, parameters.frontend)} with ${nameOf(frameworks, parameters.agentFramework)}`
            : "Switching your stack"}
        </ToolStatus>
      ),
    },
    [frontends, frameworks],
  );

  return null;
}
