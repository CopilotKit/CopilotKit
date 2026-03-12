import type { TicketMeta } from "@/lib/ticket-types";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useFrontendTool } from "@copilotkit/react-core/v2";
import { useCopilotAction } from "@copilotkit/react-core";
import { z } from "zod";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title: "V2 tool payload drops enum from parameter definitions",
  refs: ["https://copilotkit.slack.com/archives/C09C1BLEPC1/p1771446879295189"],
  notes:
    "In V1, useCopilotAction parameter enums (e.g. enum: ['todo','done']) are " +
    "included in the jsonSchema payload sent to the runtime. In V2, the same " +
    "action's parameters object is missing the enum field.\n\n" +
    "Root cause: V1's use-frontend-tool.ts bridge calls getZodParameters() " +
    "which uses convertJsonSchemaToZodSchema(). That function converts " +
    '{ type: "string", enum: ["todo","done"] } into z.string() — dropping ' +
    "the enum. The Zod schema is then passed to V2's useFrontendTool, which " +
    "converts it back to JSON schema via zodToJsonSchema() — but the enum " +
    "is already lost.\n\n" +
    "Key files:\n" +
    "  - packages/v1/react-core/src/hooks/use-frontend-tool.ts:50 (getZodParameters call)\n" +
    "  - packages/v1/shared/src/utils/json-schema.ts:260-262 (string case ignores enum)\n" +
    "  - packages/v2/agent/src/index.ts:418-420 (same bug in V2's copy)\n\n" +
    "Send any message to trigger the agent. Check the SERVER terminal for " +
    "[tkt-enum-dropped server] logs showing the tool definitions received " +
    "by the runtime — the enum field will be missing from the status parameter.",
};

// ---------------------------------------------------------------------------
// Inner component — lives inside <CopilotKit> so hooks work
// ---------------------------------------------------------------------------

function TktEnumDroppedInner() {
  console.log("[tkt-enum-dropped] Inner component mounted");

  // Register an action with enum — this is the exact pattern from the issue
  useCopilotAction({
    name: "setTaskStatus",
    description: "Sets the status of a task",
    parameters: [
      {
        name: "id",
        type: "number" as const,
        description: "The id of the task",
        required: true,
      },
      {
        name: "status",
        type: "string" as const,
        description: "The status of the task",
        enum: ["todo", "done"],
        required: true,
      },
    ],
    handler: async ({ id, status }) => {
      console.log("[tkt-enum-dropped] setTaskStatus called:", { id, status });
      console.log("[tkt-enum-dropped] status value:", status, "— expected one of: todo, done");
      return `Task ${id} set to ${status}`;
    },
  });

  return (
    <div className="flex flex-col h-[600px]">
      <div className="p-4 bg-red-50 border-b border-red-200">
        <h3 className="font-semibold text-red-800 mb-2">
          V2 payload drops enum from tool parameters
        </h3>
        <p className="text-sm text-red-700 mb-3">
          Send any message (e.g. "Set task 1 to done"). Check the <strong>server terminal</strong>{" "}
          for <code className="bg-red-100 px-1 rounded">[tkt-enum-dropped server]</code> logs
          showing the tool definitions.
        </p>
        <div className="text-xs text-red-600 space-y-2 mt-2">
          <div>
            <strong>V1 payload (correct):</strong>
            <pre className="bg-red-100 p-2 rounded mt-1 overflow-x-auto">
              {JSON.stringify(
                {
                  name: "setTaskStatus",
                  jsonSchema:
                    '{"type":"object","properties":{"status":{"type":"string","description":"...","enum":["todo","done"]}},...}',
                },
                null,
                2,
              )}
            </pre>
          </div>
          <div>
            <strong>V2 payload (broken — no enum):</strong>
            <pre className="bg-red-100 p-2 rounded mt-1 overflow-x-auto">
              {JSON.stringify(
                {
                  name: "setTaskStatus",
                  parameters: {
                    properties: {
                      status: {
                        type: "string",
                        description: "The status of the task",
                      },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      </div>
      <div className="flex-1 relative">
        <CopilotChat
          labels={{
            modalHeaderTitle: "Enum Drop Repro",
            welcomeMessageText:
              'Say "Set task 1 to done" — then check the server terminal for tool definitions.',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// V2 direct — uses useFrontendTool with z.enum() directly (no V1 bridge)
// ---------------------------------------------------------------------------

function TktEnumDroppedV2Direct() {
  console.log("[tkt-enum-dropped] V2 direct component mounted");

  useFrontendTool({
    name: "setTaskStatusV2",
    description: "Sets the status of a task (V2 direct with z.enum)",
    parameters: z.object({
      id: z.number().describe("The id of the task"),
      status: z.enum(["todo", "done"]).describe("The status of the task"),
    }),
    handler: async ({ id, status }) => {
      console.log("[tkt-enum-dropped] setTaskStatusV2 called:", { id, status });
      return `Task ${id} set to ${status}`;
    },
  });

  return (
    <div className="flex flex-col h-[600px]">
      <div className="p-4 bg-blue-50 border-b border-blue-200">
        <h3 className="font-semibold text-blue-800 mb-2">
          V2 direct: useFrontendTool with z.enum() (control)
        </h3>
        <p className="text-sm text-blue-700 mb-3">
          This uses V2's <code>useFrontendTool</code> directly with{" "}
          <code>z.enum(["todo", "done"])</code> — no V1 bridge involved. Compare the server logs for{" "}
          <code>setTaskStatusV2</code> against <code>setTaskStatus</code> above.
        </p>
      </div>
      <div className="flex-1 relative">
        <CopilotChat
          labels={{
            modalHeaderTitle: "V2 Direct Enum",
            welcomeMessageText:
              'Say "Set task 1 to done" — then check the server terminal for tool definitions.',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ticket component — wraps with CopilotKit provider
// ---------------------------------------------------------------------------

export default function TktEnumDropped() {
  console.log("[tkt-enum-dropped] Mounting with V2 CopilotRuntime endpoint");

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-2">
        V2 tool payload drops enum from parameter definitions
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        The V1→V2 bridge in <code>use-frontend-tool.ts</code> calls <code>getZodParameters()</code>{" "}
        which uses <code>convertJsonSchemaToZodSchema()</code>. That function converts{" "}
        <code>{"{ type: 'string', enum: ['todo','done'] }"}</code> into <code>z.string()</code> —
        silently dropping the enum constraint. The enum-less Zod schema is then passed to V2's{" "}
        <code>useFrontendTool</code>, which converts it back to JSON schema via{" "}
        <code>zodToJsonSchema()</code> — but the enum is already lost.
      </p>

      <h3 className="font-semibold text-sm text-gray-700 mb-2">
        Path A: V1 useCopilotAction → V2 bridge (the bug path)
      </h3>
      {/* <div className="border rounded-lg overflow-hidden">
        <CopilotKit
          runtimeUrl="/api/tickets/tkt-enum-dropped/copilot"
          agent="default"
          useSingleEndpoint
        >
          <TktEnumDroppedInner />
        </CopilotKit>
      </div> */}

      <h3 className="font-semibold text-sm text-gray-700 mb-2 mt-6">
        Path B: V2 useFrontendTool with z.enum() directly (control)
      </h3>
      <div className="border rounded-lg overflow-hidden">
        <CopilotKit
          runtimeUrl="/api/tickets/tkt-enum-dropped/copilot"
          agent="default"
          useSingleEndpoint
        >
          <TktEnumDroppedV2Direct />
        </CopilotKit>
      </div>

      <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
        <h3 className="font-semibold text-sm text-gray-700 mb-2">Root cause source pointers</h3>
        <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
          <li>
            <code>packages/v1/react-core/src/hooks/use-frontend-tool.ts:50</code> —{" "}
            <code>getZodParameters(parameters)</code> drops enum during conversion
          </li>
          <li>
            <code>packages/v1/shared/src/utils/json-schema.ts:260-262</code> — string case:{" "}
            <code>z.string()</code> ignores <code>jsonSchema.enum</code>
          </li>
          <li>
            <code>packages/v2/agent/src/index.ts:418-420</code> — same bug in V2's copy of{" "}
            <code>convertJsonSchemaToZodSchema</code>
          </li>
        </ul>
      </div>
    </div>
  );
}
