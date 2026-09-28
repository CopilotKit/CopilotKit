import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";

test("advertises fixture grants without credentials or console session data", () => {
  const response = intelligenceFixture({ method: "GET", path: "/context" });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    version: 1,
    agents: ["support", "billing"],
    askAvailable: false,
  });
  expect(JSON.stringify(response.body)).not.toMatch(
    /apiKey|Authorization|sessionToken/,
  );
});

test("serves governance records that distinguish an unverified approval answer", () => {
  const response = intelligenceFixture({
    method: "GET",
    path: "/api/v1/governance/approvals",
  });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    data: expect.arrayContaining([
      expect.objectContaining({
        family: "approval",
        details: expect.objectContaining({ verified: false }),
      }),
    ]),
    nextCursor: null,
  });
});
