/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute URL of the CopilotKit runtime when hosted separately; defaults to same-origin /api/copilotkit. */
  readonly VITE_COPILOT_RUNTIME_URL?: string;
}
