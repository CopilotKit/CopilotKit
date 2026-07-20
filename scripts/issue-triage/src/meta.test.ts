// meta.test.ts
import { test, expect } from "vitest";
import { extractMeta } from "./meta";
const block =
  '```triage-meta\n{"reproducible":true,"area":"runtime","severity":"high","labels":["bug","area:runtime"]}\n```';
test("extracts and strips the block", () => {
  const { body, meta } = extractMeta(`Root cause: X.\n\n${block}\n`);
  expect(body.trim()).toBe("Root cause: X.");
  expect(meta).toEqual({
    reproducible: true,
    area: "runtime",
    severity: "high",
    labels: ["bug", "area:runtime"],
  });
});
test("absent block → meta null, body unchanged", () => {
  const { body, meta } = extractMeta("just prose");
  expect(meta).toBeNull();
  expect(body).toBe("just prose");
});
test("malformed JSON → meta null, block stripped", () => {
  const { meta } = extractMeta("x\n```triage-meta\n{not json}\n```");
  expect(meta).toBeNull();
});
