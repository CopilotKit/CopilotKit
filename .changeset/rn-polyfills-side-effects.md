---
"@copilotkit/react-native": patch
---

fix(react-native): preserve polyfill side effects in the build so crypto/streams/etc. actually run

`@copilotkit/react-native/polyfills` aggregates the individual polyfill modules
(`crypto`, `streams`, `encoding`, `dom`, `location`) via bare `import "./polyfills/x"`
side-effect imports. The package's `sideEffects` field only listed `./dist/**`
paths, so at build time the bundler evaluated the `src/**` modules as
side-effect-free and tree-shook those bare imports out of `dist/polyfills.mjs` —
leaving only `installStreamingFetch()`. As a result none of the other polyfills
ran, and `crypto.getRandomValues` was never installed, so `uuid` (used by
`randomUUID`/`randomId` and pulled in by the provider) threw
`crypto.getRandomValues() not supported` at startup in a release/Hermes runtime.

Add the corresponding `src/**` paths to `sideEffects` so the bundler preserves the
polyfill imports. `dist/polyfills.mjs` now imports all five polyfill modules and
they execute on import as intended.
