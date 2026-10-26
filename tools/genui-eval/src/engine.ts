/**
 * The generative UI engine of react-core, imported from its source. The
 * pieces the harness needs (the surface manager, the markdown source, the
 * manifest builders) are not part of the package's public API, and the
 * harness must run the exact code that ships, so it imports the source
 * directly. Everything React-related comes from here, so one copy of React
 * is used.
 */
export { standardUI } from "../../../packages/react-core/src/v2/generative-ui/standard";
export { createGenerativeUI } from "../../../packages/react-core/src/v2/generative-ui/catalog";
export type { GenerativeUI } from "../../../packages/react-core/src/v2/generative-ui/catalog";
export {
  buildCatalogManifest,
  buildGenerativeUIEnvelope,
} from "../../../packages/react-core/src/v2/generative-ui/manifest";
export {
  buildMarkdownSurfaces,
  fenceKey,
} from "../../../packages/react-core/src/v2/generative-ui/markdown/source";
export { GenerativeUISurfaceManager } from "../../../packages/react-core/src/v2/generative-ui/surface-manager";
export { createGenerativeUIDispatcher } from "../../../packages/react-core/src/v2/generative-ui/dispatcher";
