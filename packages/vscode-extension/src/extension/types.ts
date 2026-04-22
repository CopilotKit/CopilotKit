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

/** Schema for a single component extracted from the catalog's Zod definitions */
export interface ComponentSchemaEntry {
  name: string;
  props: Record<string, unknown>;
}

// Webview -> Extension Host messages
export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "action"; payload: unknown }
  | { type: "request-rebuild" }
  | { type: "select-fixture"; name: string }
  | { type: "catalog-schema"; schema: ComponentSchemaEntry[] };

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number }>;
}
