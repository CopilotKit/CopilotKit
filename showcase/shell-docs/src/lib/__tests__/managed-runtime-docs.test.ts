import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const TELEMETRY_DOC = path.resolve(
  import.meta.dirname,
  "../../content/snippets/shared/telemetry/anonymous.mdx",
);

// Sampling deliberately left this doc in f53bbaa8d1 ("send all anonymous
// telemetry, keep the 5% gate on Segment only"), which also deleted the
// "How to adjust the telemetry sample rate" section. This test asserts the
// identity PRECEDENCE that survived, plus negative assertions so the retired
// sampling language cannot creep back in.
test("documents Runtime telemetry identity precedence", () => {
  const normalized = fs
    .readFileSync(TELEMETRY_DOC, "utf8")
    .replace(/\s+/g, " ");
  const precedenceStart = normalized.indexOf(
    "first nonblank telemetry identity that is valid in an HTTP header",
  );
  const precedenceEnd = normalized.indexOf(".", precedenceStart);
  const precedence =
    precedenceStart >= 0 && precedenceEnd > precedenceStart
      ? normalized.slice(precedenceStart, precedenceEnd)
      : "";

  expect(precedenceStart).toBeGreaterThanOrEqual(0);
  expect(precedence.indexOf("explicit `telemetryId`")).toBeGreaterThanOrEqual(
    0,
  );
  expect(precedence.indexOf("`CPK_TELEMETRY_ID`")).toBeGreaterThan(
    precedence.indexOf("explicit `telemetryId`"),
  );
  expect(precedence.indexOf("`COPILOTKIT_LICENSE_TOKEN`")).toBeGreaterThan(
    precedence.indexOf("`CPK_TELEMETRY_ID`"),
  );
  expect(normalized).toContain(
    "The CopilotKit CLI does not create or write `CPK_TELEMETRY_ID`",
  );
  expect(normalized).toContain(
    "does not automatically link Runtime events to a CLI scaffold event",
  );
  expect(normalized).toContain(
    "With none of these identities, Runtime sends anonymous telemetry.",
  );
  // Retired by f53bbaa8d1 — Runtime no longer samples at this layer.
  expect(normalized).not.toContain("without sampling");
  expect(normalized).not.toContain("anonymous sampled telemetry");
  expect(normalized).not.toContain("at the configured rate");
  expect(normalized).not.toContain(
    "first nonblank telemetry identity in this order",
  );
  expect(normalized).not.toContain(
    "Without it, Runtime keeps the anonymous sampled behavior",
  );
});
