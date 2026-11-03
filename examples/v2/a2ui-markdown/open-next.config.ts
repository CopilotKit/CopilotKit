import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Every page of this demo is prerendered and nothing revalidates, so the
// prerendered pages are served from Workers static assets. No R2 bucket or
// KV namespace is needed.
export default {
  ...defineCloudflareConfig({
    incrementalCache: staticAssetsIncrementalCache,
    enableCacheInterception: true,
  }),
  // OpenNext runs `pnpm build` by default. This example has no `build`
  // script, so the repo-wide `build` sweeps skip it. Build the workspace
  // packages it imports first, then the app.
  buildCommand:
    "pnpm -w exec nx run-many -t build --projects=@copilotkit/react-core,@copilotkit/runtime && pnpm run example-build",
};
