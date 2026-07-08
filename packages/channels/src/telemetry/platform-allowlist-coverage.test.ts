import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { normalizePlatform } from "./sanitize-error.js";

// Monorepo invariant: every official channel adapter's `platform` label must be in
// normalizePlatform()'s allow-list, otherwise a newly-added adapter's events
// silently bucket to "custom" and we lose its per-platform telemetry signal.
//
// We can't import the adapter packages (they depend on @copilotkit/channels, not the
// reverse), so we discover them by scanning sibling channels-* packages on disk. This
// runs only in the monorepo (tests aren't published), which is exactly where the
// drift would be introduced.

// packages/channels/src/telemetry/ -> packages/
const packagesDir = fileURLToPath(new URL("../../../", import.meta.url));

function discoverAdapterPlatforms(): { pkg: string; platform: string }[] {
  const found: { pkg: string; platform: string }[] = [];
  for (const entry of readdirSync(packagesDir)) {
    if (!entry.startsWith("channels-")) continue;
    // Adapter packages declare `readonly platform = "x"` in src/adapter.ts;
    // non-adapter channels-* packages (channels-ui) have no such file/field.
    const adapterFile = join(packagesDir, entry, "src", "adapter.ts");
    if (!existsSync(adapterFile)) continue;
    const src = readFileSync(adapterFile, "utf8");
    const m = src.match(/readonly\s+platform\s*=\s*["']([^"']+)["']/);
    if (m) found.push({ pkg: entry, platform: m[1]! });
  }
  return found;
}

describe("normalizePlatform allow-list coverage (monorepo invariant)", () => {
  it("covers every official channel adapter's declared platform", () => {
    const discovered = discoverAdapterPlatforms();
    // Guard against a broken scan path silently passing: we ship at least
    // slack/discord/telegram/whatsapp.
    expect(
      discovered.length,
      `expected to discover the official channel adapters under ${packagesDir}`,
    ).toBeGreaterThanOrEqual(4);

    const missing = discovered.filter(
      ({ platform }) => normalizePlatform(platform) !== platform,
    );
    expect(
      missing,
      `These adapter platforms are NOT in normalizePlatform's allow-list, so their ` +
        `telemetry would bucket to "custom". Add them to KNOWN_PLATFORMS in ` +
        `packages/channels/src/telemetry/sanitize-error.ts: ` +
        missing.map((m) => `"${m.platform}" (${m.pkg})`).join(", "),
    ).toEqual([]);
  });
});
