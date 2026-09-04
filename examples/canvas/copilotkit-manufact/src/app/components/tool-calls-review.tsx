"use client";

/**
 * /components/tool-calls-review.tsx
 *
 * Visual design review for the catch-all ToolCallView — the generic
 * tool-call renderer wired via CopilotKit's `renderToolCalls` config
 * (with `name: "*"`). Catches every tool invocation that doesn't have
 * its own dedicated render slot.
 */

import { ToolCallView, ToolCallStatus } from "@/components/copilot/ToolCallView";
import {
  ReviewHero,
  ReviewLabel,
  ReviewSubsection,
  ReviewCodeBlock,
} from "./_review-shared";

export function ToolCallsReview() {
  return (
    <section className="space-y-12">
      <ReviewHero
        eyebrow="Generative UI · tool calls"
        title="Tool-call display"
        body={
          <>
            Generic catch-all renderer for every tool invocation that
            doesn't have its own dedicated render slot. Mounts at the
            CopilotKit provider via{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              renderToolCalls={"{[{ name: \"*\", render: ToolCallView }]}"}
            </code>{" "}
            so backend Python tools (fetch_notion_leads, notion_health_check)
            and handler-only frontend tools (setLeads, setFilter, …) get a
            consistent visual without bespoke wiring per tool.
          </>
        }
      />

      <ReviewSubsection
        eyebrow="States"
        title="Three lifecycle states"
        body="The status flag comes from CopilotKit. InProgress / Executing show a spinner dot and a streaming-args preview; Complete shows a green check, a one-line summary, and an expand affordance for the full args + result."
      >
        <div className="flex flex-wrap gap-6">
          <ReviewLabel label="InProgress · args streaming">
            <ToolCallView
              name="fetch_notion_leads"
              toolCallId="t1"
              status={ToolCallStatus.InProgress}
              args={{ database_id: "" }}
            />
          </ReviewLabel>
          <ReviewLabel label="Executing · running">
            <ToolCallView
              name="notion_health_check"
              toolCallId="t2"
              status={ToolCallStatus.Executing}
              args={{}}
            />
          </ReviewLabel>
          <ReviewLabel label="Complete · with result">
            <ToolCallView
              name="setLeads"
              toolCallId="t3"
              status={ToolCallStatus.Complete}
              args={{ leads: ["… 50 leads …"] }}
              result="loaded 50 leads"
            />
          </ReviewLabel>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Result extraction"
        title="Smart summaries"
        body="The summary in the header tries to pull a useful one-liner out of the result before falling back to a length-bounded preview. Common patterns recognized: top-level array length, `rows[]` / `row_count`, `warning` / `error` flags, first scalar property."
      >
        <div className="flex flex-wrap gap-6">
          <ReviewLabel label="result with rows[]">
            <ToolCallView
              name="fetch_notion_leads"
              toolCallId="t4"
              status={ToolCallStatus.Complete}
              args={{ database_id: "" }}
              result={JSON.stringify({
                database_id: "abc-123",
                rows: new Array(50).fill({ id: "x", name: "y" }),
                schema: {},
              })}
            />
          </ReviewLabel>
          <ReviewLabel label="result with row_count">
            <ToolCallView
              name="notion_health_check"
              toolCallId="t5"
              status={ToolCallStatus.Complete}
              args={{}}
              result={JSON.stringify({
                user_id: "default",
                db_title: "AI Workshop Provider Community",
                row_count: 50,
                missing_props: [],
                error: null,
              })}
            />
          </ReviewLabel>
          <ReviewLabel label="result with warning">
            <ToolCallView
              name="fetch_notion_leads"
              toolCallId="t6"
              status={ToolCallStatus.Complete}
              args={{ database_id: "" }}
              result={JSON.stringify({
                database_id: "abc-123",
                rows: [],
                schema: {},
                warning:
                  "Fetch returned 0 rows but health_check sees 50 rows in the database. This is a transient Composio issue — DO NOT call setLeads([]).",
                health_row_count: 50,
              })}
            />
          </ReviewLabel>
          <ReviewLabel label="plain string result">
            <ToolCallView
              name="setView"
              toolCallId="t7"
              status={ToolCallStatus.Complete}
              args={{ view: "demand" }}
              result="view set to demand"
            />
          </ReviewLabel>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Resolver"
        title="Wildcard precedence"
        body="CopilotKit's tool-call resolver prefers exact-name renderers over the wildcard. So `renderEnrichmentStream`, `renderEmailDraft`, `renderRubricProposal`, etc. still mount their bespoke components — the wildcard only catches tools without a dedicated slot."
      >
        <ReviewCodeBlock>{RESOLVER_SOURCE}</ReviewCodeBlock>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Wiring"
        title="Provider registration"
        body="Lives at the CopilotKitProvider in src/app/layout.tsx. The render component is a client module imported and passed by reference — server-component layouts pass component refs through cleanly."
      >
        <ReviewCodeBlock>{REGISTRATION_SOURCE}</ReviewCodeBlock>
      </ReviewSubsection>
    </section>
  );
}

const RESOLVER_SOURCE = `// CopilotKit's match priority (paraphrased from react-core v2):
//
//   1. exact name + matching agentId
//   2. exact name + no agentId
//   3. exact name (any agentId)
//   4. wildcard "*"
//
// So this registration:
//
//   useFrontendTool({
//     name: "renderEmailDraft",
//     render: ({ args }) => <EmailDraftCard ... />,
//   });
//
// + this provider config:
//
//   <CopilotKitProvider renderToolCalls={[{ name: "*", render: ToolCallView }]}>
//
// → renderEmailDraft uses EmailDraftCard (exact match wins).
// → fetch_notion_leads, setLeads, etc. all use ToolCallView (wildcard).`;

const REGISTRATION_SOURCE = `// src/app/layout.tsx

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { ToolCallView } from "@/components/copilot/ToolCallView";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <CopilotKitProvider
          runtimeUrl="/api/copilotkit"
          publicApiKey={process.env.NEXT_PUBLIC_COPILOT_CLOUD_PUBLIC_API_KEY}
          renderToolCalls={[{ name: "*", render: ToolCallView }]}
        >
          {children}
        </CopilotKitProvider>
      </body>
    </html>
  );
}

// ToolCallView's render contract (matches CopilotKit's ToolCallRenderer):
//
//   {
//     name: string,
//     toolCallId: string,
//     args: any,                      // partial-JSON-parsed during stream
//     status: "InProgress" | "Executing" | "Complete",
//     result?: string,                // tool result content (often JSON)
//   }`;
