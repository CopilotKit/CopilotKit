import { describe, expect, it } from "vitest";
import {
  OPEN_MARKER,
  blockDiff,
  extractBlock,
  findViolations,
  markerFiles,
  maskRunner,
  normalizeBlock,
  runnerName,
} from "../validate-intelligence-wiring-block.js";

/**
 * A starter's Intelligence wiring is the one region a hosted reader copies
 * verbatim, and until this check landed nothing held it still. The parity
 * manifest lists `src/app/api/copilotkit/**` under `allowedDivergence` for
 * every instance it tracks, and no smoke test sets `COPILOTKIT_LICENSE_TOKEN`,
 * so the `intelligence:` arm has never executed in CI (OSS-982).
 *
 * The block was already byte-identical in the 21 starters that use the shared
 * demo-user setup when the check was written, so this is a ratchet rather than
 * a migration. AgentCore uses request-bound Cognito identity and has a separate
 * runtime security test. What had drifted was the warning comment — into five
 * variants, two of them missing outright — and that drift is how the localhost
 * default of OSS-981 survived in all 21 shared copies.
 */

const CANONICAL = `  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.COPILOTKIT_LICENSE_TOKEN
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.CPK_INTELLIGENCE_API_KEY ?? "",
        }),
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
        licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---`;

describe("extractBlock", () => {
  it("returns the marker-delimited region, both markers included", () => {
    const source = `export const runtime = new CopilotRuntime({\n${CANONICAL}\n});\n`;

    expect(extractBlock(source)).toBe(CANONICAL);
  });

  it("returns null when the file carries no opening marker", () => {
    expect(
      extractBlock("export const runtime = new CopilotRuntime({});\n"),
    ).toBe(null);
  });

  it("returns null for an unterminated block, so the caller can report it", () => {
    const source = `${OPEN_MARKER}\n  ...(process.env.COPILOTKIT_LICENSE_TOKEN ? {} : {}),\n`;

    expect(extractBlock(source)).toBe(null);
  });
});

/**
 * The block sits at a different nesting depth in `agentcore`, whose runtime is
 * a Lambda handler rather than a Next.js route, so a raw string comparison
 * would report every line of it. Depth is not drift; the code is what matters.
 */
describe("normalizeBlock", () => {
  it("dedents to the shallowest line", () => {
    expect(normalizeBlock("    a\n      b\n    c")).toBe("a\n  b\nc");
  });

  it("makes the same block at two nesting depths compare equal", () => {
    const deeper = CANONICAL.split("\n")
      .map((line) => `  ${line}`)
      .join("\n");

    expect(normalizeBlock(deeper)).toBe(normalizeBlock(CANONICAL));
  });

  it("strips carriage returns and trailing spaces", () => {
    expect(normalizeBlock("  a  \r\n  b\r\n")).toBe("a\nb");
  });
});

/**
 * The else arm is the one line that legitimately differs: `agentcore` runs
 * `AgentCoreRunner` because its agent is a Bedrock AgentCore session, not an
 * in-process runner. Masking the name lets the rest of the block be compared
 * exactly while the name itself is checked against a per-starter expectation.
 */
describe("runnerName", () => {
  it("reads the runner out of the else arm", () => {
    expect(runnerName(CANONICAL)).toBe("InMemoryAgentRunner");
  });

  it("reads a different runner", () => {
    const agentcore = CANONICAL.replace(
      "InMemoryAgentRunner",
      "AgentCoreRunner",
    );

    expect(runnerName(agentcore)).toBe("AgentCoreRunner");
  });

  it("returns null when the else arm constructs nothing", () => {
    const noRunner = CANONICAL.replace(
      ": { runner: new InMemoryAgentRunner() }),",
      ": {}),",
    );

    expect(runnerName(noRunner)).toBe(null);
  });
});

describe("maskRunner", () => {
  it("makes two blocks that differ only in the runner compare equal", () => {
    const agentcore = CANONICAL.replace(
      "InMemoryAgentRunner",
      "AgentCoreRunner",
    );

    expect(maskRunner(agentcore)).toBe(maskRunner(CANONICAL));
  });

  it("leaves every other difference visible", () => {
    const drifted = CANONICAL.replace("demo-user", "someone-else");

    expect(maskRunner(drifted)).not.toBe(maskRunner(CANONICAL));
  });
});

describe("blockDiff", () => {
  it("returns null for identical blocks", () => {
    expect(blockDiff(CANONICAL, CANONICAL)).toBe(null);
  });

  it("reports the first differing line, numbered from one", () => {
    const drifted = CANONICAL.replace(
      '        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),',
      '        identifyUser: () => ({ id: "someone-else", name: "Demo User" }),',
    );

    expect(blockDiff(CANONICAL, drifted)).toEqual({
      line: 7,
      expected:
        '        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),',
      actual:
        '        identifyUser: () => ({ id: "someone-else", name: "Demo User" }),',
    });
  });

  it("reports a missing line as an absent actual", () => {
    const truncated = CANONICAL.split("\n").slice(0, 3).join("\n");

    expect(blockDiff(CANONICAL, truncated)?.line).toBe(4);
  });

  it("reports an extra line as an absent expectation", () => {
    const extended = `${CANONICAL}\n  // trailing`;

    expect(blockDiff(CANONICAL, extended)).toEqual({
      line: 12,
      expected: null,
      actual: "  // trailing",
    });
  });
});

/**
 * Two assertions, because either alone can pass while the check does nothing.
 * A count that dropped to zero would make the violation list vacuously empty —
 * the failure mode of every `passWithNoTests` gate — so the file count is
 * asserted against the starter inventory as well.
 */
describe("the repository's wiring sites", () => {
  it("finds one marked site in every starter with shared Intelligence wiring", () => {
    expect(markerFiles().length).toBeGreaterThanOrEqual(21);
  });

  it("holds every site to one shape", () => {
    expect(findViolations()).toEqual([]);
  });
});
