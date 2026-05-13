/**
 * Throw-on-construction shims for the LangChain-coupled adapters that
 * moved to `@copilotkit/runtime/langchain` in 1.58.0.
 *
 * Importing any of these symbols from `@copilotkit/runtime` still resolves
 * (so existing user code type-checks against the deprecated names), but
 * constructing them throws `CopilotKitMisuseError` pointing at the new
 * subexport path, the migration codemod, and the v2 BuiltInAgent
 * destination.
 *
 * The deprecated type aliases re-export the real types so existing
 * `import type { ... }` from the runtime root preserves its structural
 * shape. Type re-exports are erased at build time; the runtime module
 * graph stays free of `@langchain/*` imports (verified by
 * `scripts/smoke-no-langchain.mjs`).
 *
 * v2 will delete this file along with the LangChain adapters themselves.
 */
import { CopilotKitMisuseError } from "@copilotkit/shared";

const removedMessage = (symbol: string) =>
  `'${symbol}' is no longer exported from '@copilotkit/runtime'. ` +
  `Import it from '@copilotkit/runtime/langchain' instead.\n` +
  `Run the codemod:\n` +
  `  npx jscodeshift -t https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/codemods/langchain-subexport.cjs --parser=tsx <paths>\n` +
  `Note: LangChain adapters will be removed entirely in v2 — migrate to BuiltInAgent.`;

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class LangChainAdapter {
  constructor() {
    throw new CopilotKitMisuseError({
      message: removedMessage("LangChainAdapter"),
    });
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class BedrockAdapter {
  constructor() {
    throw new CopilotKitMisuseError({
      message: removedMessage("BedrockAdapter"),
    });
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class GoogleGenerativeAIAdapter {
  constructor() {
    throw new CopilotKitMisuseError({
      message: removedMessage("GoogleGenerativeAIAdapter"),
    });
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class RemoteChain {
  constructor() {
    throw new CopilotKitMisuseError({
      message: removedMessage("RemoteChain"),
    });
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export type { RemoteChainParameters } from "./langchain/langserve";

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export type { LangChainReturnType } from "./langchain/types";
