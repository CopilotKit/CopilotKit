// Message protocol between extension host and webview

export interface A2UIFixture {
  surfaceId: string;
  messages: unknown[];
}

export interface DiscoveredComponent {
  name: string;
  filePath: string;
  fixturePath?: string;
  fixtureNames?: string[];
}

// Extension Host -> Webview messages
export type ExtensionToWebviewMessage =
  | { type: "catalog-update"; code: string; css?: string }
  | {
      type: "fixture-update";
      fixtures: Record<string, A2UIFixture>;
      activeFixture?: string;
    }
  | { type: "error"; message: string };

// Webview -> Extension Host messages
export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "action"; payload: unknown }
  | { type: "request-rebuild" }
  | { type: "select-fixture"; name: string };

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number }>;
}
