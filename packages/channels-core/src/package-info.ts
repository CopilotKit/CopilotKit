import { createRequire } from "node:module";

const PACKAGE_NAME = "@copilotkit/channels-core";
const UNBUILT_VERSION = "0.0.0-unbuilt";

export interface ChannelsCorePackageInfo {
  name: string;
  version: string;
}

let cachedPackageInfo: ChannelsCorePackageInfo | undefined;

/**
 * Read the package identity without requiring `import.meta.url` at module load.
 *
 * Cloudflare Workers with `nodejs_compat` can resolve `node:module`, but do not
 * provide `import.meta.url`. Telemetry falls back to a valid package name and an
 * explicit unbuilt version when package metadata cannot be read.
 */
export function getChannelsCorePackageInfo(): ChannelsCorePackageInfo {
  if (cachedPackageInfo) return cachedPackageInfo;

  try {
    const pkg = createRequire(import.meta.url)("../package.json") as {
      name?: unknown;
      version?: unknown;
    };
    if (typeof pkg.name === "string" && typeof pkg.version === "string") {
      cachedPackageInfo = { name: pkg.name, version: pkg.version };
      return cachedPackageInfo;
    }
  } catch {
    // Worker runtimes may not expose import.meta.url.
  }

  cachedPackageInfo = { name: PACKAGE_NAME, version: UNBUILT_VERSION };
  return cachedPackageInfo;
}
