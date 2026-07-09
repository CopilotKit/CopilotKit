#!/usr/bin/env node
/**
 * aimock launcher for the deterministic banking E2Es.
 *
 * Starts an aimock server on $AIMOCK_PORT (default 7099) so the banking dev server
 * can point OPENAI_BASE_URL at it and get deterministic agent tool calls. The
 * fixture file is $AIMOCK_FIXTURES (a path relative to cwd, or absolute); when
 * unset it defaults to fixtures/memory-learning.fixtures.json. The OGUI routing
 * suite (playwright.ogui.config.ts) sets AIMOCK_FIXTURES=fixtures/ogui-routing...
 * on its own aimock instance (port 7098).
 *
 * Used as a Playwright webServer entry — Playwright waits on the readiness URL
 * before starting the dev server.
 *
 * VERIFY ON FIRST GREEN RUN (unverified API assumptions):
 * - The exact @copilotkit/aimock programmatic API. This uses the documented
 *   `loadFixtureFile` + a server factory. If the named exports differ, the
 *   simplest robust fallback is the bundled CLI instead of this script, e.g.:
 *     pnpm exec aimock --port 7099 --validate-on-load e2e/fixtures/memory-learning.fixtures.json
 *   (confirm the CLI's fixture-path flag; `aimock --help`). If you switch to the
 *   CLI, set playwright.config webServer[0].command accordingly and delete this file.
 * - The readiness endpoint path (this assumes GET /health returns 200 once ready).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.env.AIMOCK_PORT ?? 7099);
const FIXTURES = process.env.AIMOCK_FIXTURES
  ? process.env.AIMOCK_FIXTURES.startsWith("/")
    ? process.env.AIMOCK_FIXTURES
    : join(process.cwd(), process.env.AIMOCK_FIXTURES)
  : join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "memory-learning.fixtures.json",
    );

const mod = await import("@copilotkit/aimock");

// Preferred path: load + validate the fixture file, then start a server bound to it.
// The exact factory name is the main thing to confirm; we try the documented ones.
// Confirmed exports in @copilotkit/aimock@1.19.1: LLMock, loadFixtureFile,
// validateFixtures, createServer. LLMock is the OpenAI-shape mock server.
const loadFixtureFile = mod.loadFixtureFile ?? mod.default?.loadFixtureFile;
const validateFixtures = mod.validateFixtures ?? mod.default?.validateFixtures;
const ServerCtor = mod.LLMock ?? mod.default?.LLMock;

if (!ServerCtor) {
  console.error(
    "[aimock-server] Could not find a server constructor in @copilotkit/aimock.\n" +
      "Use the bundled CLI instead (see header): pnpm exec aimock --port " +
      PORT +
      " --validate-on-load " +
      FIXTURES,
  );
  process.exit(2);
}

// loadFixtureFile returns a ready-to-use array of converted Fixture objects
// (it parses the {fixtures:[...]} file and applies entryToFixture).
const loadedFixtures = loadFixtureFile
  ? loadFixtureFile(FIXTURES)
  : (JSON.parse(
      await (await import("node:fs/promises")).readFile(FIXTURES, "utf8"),
    ).fixtures ?? []);
if (validateFixtures) validateFixtures(loadedFixtures);

// NOTE: LLMock's constructor does NOT read `options.fixtures` — fixtures passed
// that way are silently dropped and the server starts with zero fixtures (so
// every LLM turn 404s "No fixture matched" and the agent never advances). They
// MUST be registered via addFixtures()/addFixture(). (Verified against
// @copilotkit/aimock@1.19.1: `new LLMock({fixtures}).getFixtures().length === 0`.)
const server = new ServerCtor({ port: PORT });
server.addFixtures(loadedFixtures);
await server.start();
console.log(
  `[aimock-server] listening on :${PORT} with ${server.getFixtures().length} fixtures`,
);

const shutdown = async () => {
  try {
    await server.stop?.();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
