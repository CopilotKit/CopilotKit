// The agents of each google-antigravity demo. One agent server mounts an
// Antigravity agent for each demo, at a path named after the agent.
import { DEMO_AGENT_IDS } from "@/demo-agents";
import { httpAgent } from "@/lib/agents";
import type { IntegrationRuntime, RuntimeOptions } from "@/lib/agents";
import { createTranscriptionService } from "@/lib/transcription-service";

// The path of each demo's agent on the agent server, by demo id.
const AGENT_PATHS: Partial<Record<string, string>> = {
  "a2ui-fixed-schema": "/a2ui_fixed_schema",
  "a2ui-recovery": "/a2ui_recovery",
  "agent-config": "/agent-config-demo",
  "agentic-chat": "/agentic_chat",
  auth: "/auth",
  "beautiful-chat": "/beautiful_chat",
  "chat-customization-css": "/chat-customization-css",
  "chat-slots": "/chat-slots",
  "declarative-gen-ui": "/declarative_gen_ui",
  "declarative-hashbrown": "/declarative_hashbrown",
  "declarative-json-render": "/declarative_json_render",
  "frontend-tools": "/frontend_tools",
  "frontend-tools-async": "/frontend-tools-async",
  "gen-ui-agent": "/gen-ui-agent",
  "gen-ui-tool-based": "/gen-ui-tool-based",
  "headless-complete": "/headless_complete",
  "headless-simple": "/headless-simple",
  "hitl-in-app": "/hitl-in-app",
  "hitl-in-chat": "/hitl-in-chat",
  "mcp-apps": "/mcp-apps",
  multimodal: "/multimodal-demo",
  "open-gen-ui": "/open_gen_ui",
  "open-gen-ui-advanced": "/open_gen_ui_advanced",
  "prebuilt-popup": "/prebuilt-popup",
  "prebuilt-sidebar": "/prebuilt-sidebar",
  "readonly-state-agent-context": "/readonly-state-agent-context",
  "reasoning-custom": "/reasoning-custom",
  "reasoning-default": "/reasoning-default",
  "shared-state-read": "/shared-state-read",
  "shared-state-read-write": "/shared-state-read-write",
  subagents: "/subagents",
  "threadid-frontend-tool-roundtrip": "/threadid-frontend-tool-roundtrip",
  "tool-rendering": "/tool-rendering",
  "tool-rendering-custom-catchall": "/tool-rendering-custom-catchall",
  "tool-rendering-default-catchall": "/tool-rendering-default-catchall",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning-chain",
  voice: "/voice",
};

// The runtime options that replace DEMO_RUNTIME_OPTIONS for
// google-antigravity, key by key, by demo id.
const RUNTIME_OPTIONS: Partial<Record<string, () => RuntimeOptions>> = {
  // Transcribes with OPENAI_TRANSCRIPTION_API_KEY. Without it the voice demo
  // has no transcription.
  voice: () => ({ transcriptionService: createTranscriptionService() }),
};

export default {
  createRuntimeConfig(demoId) {
    const path = AGENT_PATHS[demoId];
    const agentIds = DEMO_AGENT_IDS[demoId];
    if (path === undefined || agentIds === undefined) return undefined;
    const agents = Object.fromEntries(
      agentIds.map((agentId) => [
        agentId,
        httpAgent("google-antigravity", path),
      ]),
    );
    return { agents, options: RUNTIME_OPTIONS[demoId]?.() };
  },
} satisfies IntegrationRuntime;
