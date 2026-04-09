/**
 * Validate SEO Redirects
 *
 * For each redirect in seo-redirects.ts:
 *   1. Sends a request with redirect: 'manual'
 *   2. Verifies 301 status + correct Location header
 *   3. Follows the redirect and verifies 200 (destination exists)
 *
 * Usage:
 *   npx tsx showcase/scripts/validate-redirects.ts
 *   npx tsx showcase/scripts/validate-redirects.ts --base-url http://localhost:3000
 *   npx tsx showcase/scripts/validate-redirects.ts --id P1  # filter by spec ID prefix
 */

import {
  seoRedirects,
  type RedirectEntry,
} from "../shell/src/lib/seo-redirects";

const DEFAULT_BASE = "http://localhost:3000";

interface ValidationResult {
  id: string;
  source: string;
  expectedDestination: string;
  status: "pass" | "fail" | "skip";
  error?: string;
  actualStatus?: number;
  actualLocation?: string;
  destinationStatus?: number;
}

function parseArgs(): { baseUrl: string; idFilter?: string } {
  const args = process.argv.slice(2);
  let baseUrl = DEFAULT_BASE;
  let idFilter: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base-url" && args[i + 1]) baseUrl = args[++i];
    if (args[i] === "--id" && args[i + 1]) idFilter = args[++i];
  }
  return { baseUrl, idFilter };
}

function expandWildcard(
  entry: RedirectEntry,
): { source: string; destination: string } | null {
  // For wildcard entries, generate a test URL by appending "test-path"
  if (entry.source.includes(":path*")) {
    const testSource = entry.source.replace(":path*", "test-path");
    let testDest: string;
    if (entry.destination.includes(":path*")) {
      testDest = entry.destination.replace(":path*", "test-path");
    } else {
      testDest = entry.destination;
    }
    return { source: testSource, destination: testDest };
  }
  return { source: entry.source, destination: entry.destination };
}

async function validateEntry(
  entry: RedirectEntry,
  baseUrl: string,
): Promise<ValidationResult> {
  const expanded = expandWildcard(entry);
  if (!expanded) {
    return {
      id: entry.id,
      source: entry.source,
      expectedDestination: entry.destination,
      status: "skip",
      error: "Could not expand wildcard",
    };
  }

  const { source, destination } = expanded;
  const url = `${baseUrl}${source}`;

  try {
    // Step 1: Check redirect (don't follow)
    const res = await fetch(url, { redirect: "manual" });

    if (res.status !== 301) {
      return {
        id: entry.id,
        source,
        expectedDestination: destination,
        status: "fail",
        error: `Expected 301, got ${res.status}`,
        actualStatus: res.status,
      };
    }

    const location = res.headers.get("location") || "";
    // Location may be absolute or relative — normalize
    const actualPath = location.startsWith("http")
      ? new URL(location).pathname
      : location;

    if (actualPath !== destination) {
      return {
        id: entry.id,
        source,
        expectedDestination: destination,
        status: "fail",
        error: `Location mismatch: expected ${destination}, got ${actualPath}`,
        actualStatus: 301,
        actualLocation: actualPath,
      };
    }

    // Step 2: Follow redirect, check destination exists
    const destRes = await fetch(`${baseUrl}${destination}`, {
      redirect: "follow",
    });
    if (destRes.status >= 400) {
      return {
        id: entry.id,
        source,
        expectedDestination: destination,
        status: "fail",
        error: `Destination returned ${destRes.status}`,
        actualStatus: 301,
        actualLocation: actualPath,
        destinationStatus: destRes.status,
      };
    }

    return {
      id: entry.id,
      source,
      expectedDestination: destination,
      status: "pass",
      actualStatus: 301,
      actualLocation: actualPath,
      destinationStatus: destRes.status,
    };
  } catch (err) {
    return {
      id: entry.id,
      source,
      expectedDestination: destination,
      status: "fail",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const { baseUrl, idFilter } = parseArgs();
  console.log(`=== SEO Redirect Validation ===`);
  console.log(`Base URL: ${baseUrl}`);
  if (idFilter) console.log(`Filter: ${idFilter}`);

  let entries = seoRedirects;
  if (idFilter) {
    entries = entries.filter((e) => e.id.startsWith(idFilter));
  }

  console.log(`Validating ${entries.length} redirect(s)...\n`);

  const results: ValidationResult[] = [];
  // Run sequentially to avoid overwhelming the server
  for (const entry of entries) {
    const result = await validateEntry(entry, baseUrl);
    results.push(result);
    const icon =
      result.status === "pass" ? "✓" : result.status === "skip" ? "⊘" : "✗";
    console.log(
      `  ${icon} ${result.id}: ${result.source} → ${result.expectedDestination}${result.error ? ` (${result.error})` : ""}`,
    );
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  console.log(`\n=== RESULTS ===`);
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed > 0) console.log(`Failed: ${failed}`);
  if (skipped > 0) console.log(`Skipped: ${skipped}`);

  if (failed > 0) {
    console.log(`\nFailed entries:`);
    for (const r of results.filter((r) => r.status === "fail")) {
      console.log(`  ${r.id}: ${r.source} — ${r.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
