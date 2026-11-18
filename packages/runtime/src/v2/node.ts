/**
 * `@copilotkit/runtime/v2/node`, the import path of the 2.0 Node.js listener
 * in CopilotKit 1.x. In 2.0 it is a deprecated alias of
 * `@copilotkit/runtime/node`, so 1.x code that imports from it keeps working.
 * It exports every export of `@copilotkit/runtime/node`, and the 1.x names of
 * those exports. Each old name is the same value or type as its new name.
 *
 * `npx codemod @copilotkit/v2-migration` moves the imports to
 * `@copilotkit/runtime/node` and renames them. The build marks each name of
 * this entry deprecated in its declarations
 * (scripts/deprecations/v2-subpath-aliases.mts).
 */
import {
  createCopilotKitNodeHandler,
  createCopilotKitNodeListener,
} from "../node";
import type {
  NodeCopilotKitListener,
  NodeCopilotKitListenerWithChannels,
} from "../node";

export * from "../node";

/**
 * @deprecated Use `createCopilotKitNodeListener` from
 * `@copilotkit/runtime/node`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export const createCopilotNodeListener = createCopilotKitNodeListener;
/**
 * @deprecated Use `createCopilotKitNodeHandler` from
 * `@copilotkit/runtime/node`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export const createCopilotNodeHandler = createCopilotKitNodeHandler;
/**
 * @deprecated Use `createCopilotKitNodeHandler` from
 * `@copilotkit/runtime/node`. 1.x deprecated this name, and it is an alias of
 * `createCopilotKitNodeHandler`. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export const createNodeFetchHandler = createCopilotKitNodeHandler;
/**
 * @deprecated Use `NodeCopilotKitListener` from `@copilotkit/runtime/node`.
 * This old name is an alias of it. To move your imports, run
 * `npx codemod @copilotkit/v2-migration`.
 */
export type NodeCopilotListener = NodeCopilotKitListener;
/**
 * @deprecated Use `NodeCopilotKitListenerWithChannels` from
 * `@copilotkit/runtime/node`. This old name is an alias of it. To move your
 * imports, run `npx codemod @copilotkit/v2-migration`.
 */
export type NodeCopilotListenerWithChannels =
  NodeCopilotKitListenerWithChannels;
