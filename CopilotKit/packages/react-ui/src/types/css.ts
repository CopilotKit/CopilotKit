import { CSSProperties } from "react";

export interface CopilotKitCSSProperties extends CSSProperties {
  "--copilot-kit-primary-color"?: string;
  "--copilot-kit-contrast-color"?: string;
  "--copilot-kit-secondary-color"?: string;
  "--copilot-kit-secondary-contrast-color"?: string;
  "--copilot-kit-background-color"?: string;
  "--copilot-kit-muted-color"?: string;
  "--copilot-kit-separator-color"?: string;
  "--copilot-kit-scrollbar-color"?: string;
  "--copilot-kit-response-button-color"?: string;
  "--copilot-kit-response-button-background-color"?: string;
}