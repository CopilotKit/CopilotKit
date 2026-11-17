// strands serves this demo from its shared chat agent. That agent's system
// prompt does not make it call generateSandboxedUi, so the page asks for the
// call in the design skill.
import type { OpenGenUiConfig } from "@/app/demos/[integration]/open-gen-ui/config";

export default {
  instructToolCall: true,
} satisfies OpenGenUiConfig;
