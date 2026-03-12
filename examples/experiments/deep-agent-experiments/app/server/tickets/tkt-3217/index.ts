import {
  CopilotRuntime,
  LangChainAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";

// ---------------------------------------------------------------------------
// tkt-3217: LangChainAdapter regression in v1.50.0+
//
// The runtime wraps LangChainAdapter in a BuiltInAgent, reading .provider and
// .model — which don't exist. This produces "undefined/undefined" and crashes
// with "Unknown provider undefined". Even if patched, BuiltInAgent never calls
// serviceAdapter.process(), so the chainFn is silently bypassed.
// ---------------------------------------------------------------------------

console.log("[tkt-3217 server] Initializing LangChainAdapter with custom chainFn");

const serviceAdapter = new LangChainAdapter({
  chainFn: async ({ messages, tools }) => {
    // This function should be called by the runtime but is never reached
    // because BuiltInAgent bypasses serviceAdapter.process().
    console.log("[tkt-3217 server] chainFn invoked!", {
      messageCount: messages.length,
      toolCount: tools.length,
      lastMessage: messages[messages.length - 1]?.content,
    });

    // Return a plain string — LangChainAdapter supports this return type.
    // In a real app this would be model.bindTools(tools).stream(messages).
    return `Echo from LangChainAdapter chainFn: received ${messages.length} message(s)`;
  },
});

console.log("[tkt-3217 server] LangChainAdapter created", {
  hasProcess: typeof (serviceAdapter as any).process === "function",
  provider: (serviceAdapter as any).provider,
  model: (serviceAdapter as any).model,
});

const runtime = new CopilotRuntime();

console.log("[tkt-3217 server] CopilotRuntime created, mounting endpoint");

export const handler = copilotRuntimeNodeHttpEndpoint({
  runtime,
  serviceAdapter,
  endpoint: "/api/tickets/tkt-3217/copilot",
});

console.log("[tkt-3217 server] Endpoint mounted at /api/tickets/tkt-3217/copilot");
