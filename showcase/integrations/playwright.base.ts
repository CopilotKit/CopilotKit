import type {
  PlaywrightTestConfig,
  devices as Devices,
} from "@playwright/test";

/**
 * Shared base Playwright config for every showcase integration.
 *
 * Single-path browser/server design: when the harness exports
 * PLAYWRIGHT_WS_ENDPOINT, every integration connects to ONE shared browser
 * server via `use.connectOptions.wsEndpoint`. When the var is unset (the
 * contributor path), Playwright launches a browser locally as normal.
 *
 * `connect()` requires the client and server Playwright major.minor to match,
 * so every integration pins `@playwright/test` to the same exact version as the
 * harness (1.59.1). Likewise `retries` is unified to ONE value (0) across all
 * integrations for true verdict-equivalence — no `process.env.CI ? 2 : 0|1`
 * branching. `launchOptions`/`headless`/`channel` are deliberately omitted:
 * they are ignored in connect mode.
 *
 * NB: this file lives one level above each integration's project root, so it
 * deliberately does NOT `require("@playwright/test")` at runtime (that module
 * only resolves from inside an integration's own node_modules). Each
 * integration imports `defineConfig`/`devices` from its own dependency and
 * passes `devices` in, then wraps the returned plain object with `defineConfig`.
 */

const WS_ENDPOINT = process.env.PLAYWRIGHT_WS_ENDPOINT;

export interface BaseConfigOptions {
  /** The `devices` map from the integration's own `@playwright/test`. */
  devices: typeof Devices;
  /** Per-integration slug used for the `X-AIMock-Context` HTTP header. */
  slug?: string;
  /** Default base URL when `BASE_URL` is not set (defaults to localhost:3000). */
  baseURL?: string;
  /** Per-integration overrides merged on top of the shared base. */
  overrides?: PlaywrightTestConfig;
}

/**
 * Build a Playwright config object from the shared base.
 *
 * Each integration supplies ONLY its per-integration bits (its `slug` for the
 * `X-AIMock-Context` header, and any genuinely integration-specific overrides
 * such as a custom `webServer`). Everything shared — connect options, the
 * unified single retry value, the chromium project — lives here. The caller
 * wraps the result with its own `defineConfig`.
 */
export function buildIntegrationConfig(
  options: BaseConfigOptions,
): PlaywrightTestConfig {
  const { devices, slug, baseURL, overrides = {} } = options;

  const {
    use: useOverrides,
    projects: projectOverrides,
    ...restOverrides
  } = overrides;

  return {
    testDir: "./tests/e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // ONE unified retry value across every integration for true
    // verdict-equivalence. Do NOT reintroduce `process.env.CI ? ... : ...`.
    retries: 0,
    reporter: "html",
    use: {
      baseURL: process.env.BASE_URL || baseURL || "http://localhost:3000",
      trace: "on-first-retry",
      // When PLAYWRIGHT_WS_ENDPOINT is set, connect to the shared browser
      // server; otherwise launch locally (contributor path preserved).
      connectOptions: WS_ENDPOINT ? { wsEndpoint: WS_ENDPOINT } : undefined,
      ...(slug ? { extraHTTPHeaders: { "X-AIMock-Context": slug } } : {}),
      ...useOverrides,
    },
    projects: projectOverrides ?? [
      {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] },
      },
    ],
    ...restOverrides,
  };
}
