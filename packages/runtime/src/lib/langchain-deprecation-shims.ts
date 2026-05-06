/**
 * Throw-on-construction shims for the LangChain-coupled adapters that
 * moved to `@copilotkit/runtime/langchain` in 1.58.0.
 *
 * Importing any of these symbols from `@copilotkit/runtime` still resolves
 * (so existing user code type-checks against the deprecated names), but
 * constructing them throws an error pointing at the new subexport path,
 * the migration codemod, and the v2 BuiltInAgent destination.
 *
 * These are deliberately isolated from `lib/index.ts` so they can be
 * unit-tested without pulling in the full runtime module graph (which
 * triggers type-graphql decorators at load time). They are re-exported
 * from `lib/index.ts` to preserve the public surface.
 *
 * v2 will delete this file along with the LangChain adapters themselves.
 */

const langchainSubexportMessage = (symbol: string) =>
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
    throw new Error(langchainSubexportMessage("LangChainAdapter"));
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class BedrockAdapter {
  constructor() {
    throw new Error(langchainSubexportMessage("BedrockAdapter"));
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class GoogleGenerativeAIAdapter {
  constructor() {
    throw new Error(langchainSubexportMessage("GoogleGenerativeAIAdapter"));
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class RemoteChain {
  constructor() {
    throw new Error(langchainSubexportMessage("RemoteChain"));
  }
}

// Re-export the real types so `import type { RemoteChainParameters }` from
// the runtime root keeps its structural shape instead of silently widening
// to `any`. These are erased at runtime (no @langchain/* runtime import),
// but they preserve type-checking for consumers who still reference them
// via the deprecated path.

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export type { RemoteChainParameters } from "../service-adapters/langchain/langserve";

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export type { LangChainReturnType } from "../service-adapters/langchain/types";
