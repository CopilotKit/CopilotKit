// Fixture for the generative-ui/native contract, shaped like the real regression:
// the `@a2ui/web_core/v0_9` barrel re-exports the basic catalog's Lit elements,
// so importing ONE model from it loads lit-html (which reads `document` at module
// load) under Hermes. packages/core's generative UI surface manager once did this.
export { SurfaceModel } from "@a2ui/web_core/v0_9";
