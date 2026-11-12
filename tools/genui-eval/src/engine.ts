/**
 * The generative UI engine, imported from its source. The pieces the
 * harness needs (the surface manager, the markdown source, the manifest
 * builders) are not part of the packages' public API, and the harness must
 * run the exact code that ships, so it imports the source directly. The
 * engine lives in core; the React catalog and components come from
 * react-core, so one copy of React is used.
 */
export { standardUI } from "../../../packages/react-core/src/generative-ui/standard";
export { createGenerativeUI } from "../../../packages/react-core/src/generative-ui/catalog";
export type { GenerativeUI } from "../../../packages/react-core/src/generative-ui/catalog";
export {
  buildCatalogManifest,
  buildGenerativeUIEnvelope,
} from "../../../packages/core/src/generative-ui/manifest";
export {
  buildMarkdownSurfaces,
  fenceKey,
} from "../../../packages/core/src/generative-ui/markdown-source";
export { GenerativeUISurfaceManager } from "../../../packages/core/src/generative-ui/surface-manager";
export { createGenerativeUIDispatcher } from "../../../packages/core/src/generative-ui/dispatcher";
