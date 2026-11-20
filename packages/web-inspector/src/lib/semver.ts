// The semver functions the inspector uses. tsdown bundles this file into a
// single module (see tsdown.config.ts): semver only ships CommonJS, and its
// files require each other in a cycle that breaks when they are emitted as
// separate ES modules.
export { prerelease, satisfies, valid, validRange } from "semver";
