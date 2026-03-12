import { useEffect } from "react";
import type { TicketMeta } from "@/lib/ticket-types";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useCopilotReadable } from "@copilotkit/react-core";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title: "BuiltInAgent incompatible with AI SDK v6 (LanguageModelV3)",
  refs: [
    "https://copilotkit.slack.com/archives/C070G2NGHDX/p1772032203248049",
    "https://github.com/mubinansari/copilotkit-1.50-integration/tree/11-copilot-built-in-agent-with-ai-sdk-v6",
  ],
  notes:
    "CopilotKit's BuiltInAgentConfiguration.model expects LanguageModel from ai@^5 " +
    "(LanguageModelV2, specificationVersion: 'v2'). AI SDK v6 providers " +
    "(@ai-sdk/openai@^3, @ai-sdk/azure@^3, etc.) return LanguageModelV3 " +
    "(specificationVersion: 'v3'). This causes a TypeScript error when passing " +
    "a v6 model instance to new BuiltInAgent({ model }). " +
    "Downgrading to AI SDK v5 is not viable for teams already using v6 features.\n\n" +
    "The server handler uses @ts-expect-error to suppress the type error and " +
    "demonstrate that the models are wire-compatible at runtime — only the " +
    "TypeScript type guard differs.",
};

// ---------------------------------------------------------------------------
// Inner component — lives inside <CopilotKit> so hooks work
// ---------------------------------------------------------------------------

function TktBuiltinAisdkV6Inner() {
  console.log("[tkt-builtin-aisdk-v6] Inner component mounted");

  useCopilotReadable({
    description: "Sample data for testing the BuiltInAgent",
    value: [
      { task: "Review PR #42", status: "pending" },
      { task: "Deploy staging", status: "done" },
    ],
  });

  useEffect(() => {
    console.log("[tkt-builtin-aisdk-v6] Ready — send a message to test BuiltInAgent + AI SDK v6");
  }, []);

  return (
    <div className="flex flex-col h-[600px]">
      <div className="p-4 bg-red-50 border-b border-red-200">
        <h3 className="font-semibold text-red-800 mb-2">
          Type Error: LanguageModelV3 not assignable to LanguageModelV2
        </h3>
        <pre className="text-xs text-red-700 bg-red-100 p-3 rounded overflow-x-auto mb-3">
          {`// @ai-sdk/openai@^3 (AI SDK v6) returns LanguageModelV3
const openai = createOpenAI({ apiKey: "..." });
const model = openai("gpt-4o-mini");
// model.specificationVersion === "v3"

// BuiltInAgent expects LanguageModel from ai@^5 (= LanguageModelV2)
const agent = new BuiltInAgent({
  model: model, // TS Error!
  //     ^^^^^
  // Type 'LanguageModelV3' is not assignable to
  // type 'BuiltInAgentModel | LanguageModel'.
  // Types of property 'specificationVersion' are incompatible.
  // Type '"v3"' is not assignable to type '"v2"'.
});`}
        </pre>
        <div className="text-xs text-red-600 space-y-1">
          <p>
            <strong>Root cause:</strong> <code>@copilotkitnext/agent</code> depends on{" "}
            <code>ai@^5</code> which exports <code>LanguageModel</code> as{" "}
            <code>LanguageModelV2</code> (specificationVersion: "v2").
          </p>
          <p>
            <strong>User's stack:</strong> <code>ai@6.x</code> + <code>@ai-sdk/openai@^3</code> (or{" "}
            <code>@ai-sdk/azure@^3</code>) which return <code>LanguageModelV3</code>{" "}
            (specificationVersion: "v3").
          </p>
          <p>
            <strong>Workaround:</strong> Use string model identifiers (e.g.{" "}
            <code>"openai/gpt-4o"</code>) instead of provider instances. But this blocks users who
            need custom provider config (Azure endpoints, custom base URLs, etc.).
          </p>
        </div>
      </div>
      <div className="flex-1 relative">
        <CopilotChat
          labels={{
            modalHeaderTitle: "BuiltInAgent + AI SDK v6",
            welcomeMessageText:
              "This chat uses BuiltInAgent with an AI SDK v6 model (via @ts-expect-error). " +
              "Send a message to verify runtime compatibility.",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ticket component — wraps with CopilotKit provider
// ---------------------------------------------------------------------------

export default function TktBuiltinAisdkV6() {
  console.log("[tkt-builtin-aisdk-v6] Mounting");

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-2">
        BuiltInAgent + AI SDK v6: LanguageModelV3 type incompatibility
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        <code>BuiltInAgentConfiguration.model</code> expects <code>LanguageModel</code> from{" "}
        <code>ai@^5</code> (= <code>LanguageModelV2</code>). AI SDK v6 providers return{" "}
        <code>LanguageModelV3</code>. This is a compile-time type error — the models are
        wire-compatible at runtime.
      </p>

      <div className="border rounded-lg overflow-hidden">
        <CopilotKit
          runtimeUrl="/api/tickets/tkt-builtin-aisdk-v6/copilot"
          agent="default"
          useSingleEndpoint
        >
          <TktBuiltinAisdkV6Inner />
        </CopilotKit>
      </div>

      <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
        <h3 className="font-semibold text-sm text-gray-700 mb-2">Dependency chain</h3>
        <pre className="text-xs text-gray-600 whitespace-pre-wrap">
          {`@copilotkit/runtime/v2
  └─ re-exports @copilotkitnext/agent
       └─ depends on ai@^5
            └─ exports LanguageModel = LanguageModelV2 (specificationVersion: "v2")

User's project
  └─ ai@6.x + @ai-sdk/openai@^3 (or @ai-sdk/azure@^3)
       └─ models have specificationVersion: "v3" = LanguageModelV3

BuiltInAgentConfiguration.model: BuiltInAgentModel | LanguageModel
                                                       ^^^^^^^^^^^^
                                                       This is LanguageModelV2 from ai@^5
                                                       but user passes LanguageModelV3`}
        </pre>
      </div>
    </div>
  );
}
