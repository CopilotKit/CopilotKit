// The channels-core package name and version, embedded without JSON import or
// createRequire so this module is safe to load on Cloudflare Workers where
// import.meta.url is undefined (#8539).
//
// The version is injected by tsdown at build time (tsdown.config.ts) and by
// vitest at test time (vitest.config.ts). Code that runs this source with
// neither gets the placeholder. The packed-package check in
// scripts/release/verify-runtime-package.ts fails if a published build carries
// the placeholder instead of the real version.
declare const __CHANNELS_CORE_PACKAGE_VERSION__: string | undefined;

export const CHANNELS_CORE_PACKAGE_NAME = "@copilotkit/channels-core";
export const CHANNELS_CORE_PACKAGE_VERSION: string =
  typeof __CHANNELS_CORE_PACKAGE_VERSION__ === "string"
    ? __CHANNELS_CORE_PACKAGE_VERSION__
    : "0.0.0-unbuilt";
