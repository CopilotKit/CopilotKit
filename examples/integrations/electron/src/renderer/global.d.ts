import type { CopilotKitBridge } from "../preload";

declare global {
  interface Window {
    copilotkit: CopilotKitBridge;
  }
}

export {};
