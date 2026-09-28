import { expect, test } from "vitest";
import { parseInspectorReadRequest } from "../handlers/shared/inspector-read-request";

test("accepts metrics queries and the documented product read paths", () => {
  for (const path of [
    "/context",
    "/api/v1/metrics",
    "/api/v1/runs",
    "/api/v1/tools",
    "/api/v1/tools/refund",
    "/api/v1/conversations",
    "/api/v1/conversations/thread-1/replay",
    "/api/v1/events",
    "/api/v1/governance/events",
    "/api/v1/governance/summary",
    "/api/v1/governance/approvals",
    "/api/v1/governance/access",
    "/api/v1/governance/deletions",
    "/api/v1/governance/runs/run-1",
    "/api/v1/learning/insights",
    "/api/v1/learning/skills",
    "/api/v1/learning/skills/skill-1/lineage",
    "/api/v1/learning/topics",
  ]) {
    expect(parseInspectorReadRequest({ method: "GET", path })).toEqual({
      method: "GET",
      path,
    });
  }
  const query = {
    method: "POST",
    path: "/api/v1/metrics/query",
    body: { metric: "runs" },
  };
  expect(parseInspectorReadRequest(query)).toEqual(query);
});

test("rejects arbitrary upstream targets, traversal, credentials and mutations", () => {
  for (const path of [
    "https://attacker.example/api/v1/runs",
    "//attacker.example",
    "/api/v1/runs?key=secret",
    "/api/v1/tools/../keys",
    "/api/v1/tools/%2e%2e",
    "/api/v1/tools/%2fkeys",
    "/api/v1/tools/%5ckeys",
    "/api/v1/tools/%252e%252e",
    "/api/v1/tools/abc#fragment",
    "/api/keys",
    "/api/v1/learning/skills/a/revoke",
  ]) {
    expect(parseInspectorReadRequest({ method: "GET", path })).toBeNull();
  }
  expect(
    parseInspectorReadRequest({
      method: "DELETE",
      path: "/api/v1/conversations/a",
    }),
  ).toBeNull();
  expect(
    parseInspectorReadRequest({ method: "POST", path: "/api/v1/runs" }),
  ).toBeNull();
  expect(
    parseInspectorReadRequest({
      method: "GET",
      path: "/api/v1/runs",
      headers: { "x-cpki-grant": "forged" },
    }),
  ).toBeNull();
  expect(
    parseInspectorReadRequest({
      method: "GET",
      path: "/api/v1/runs",
      body: {},
    }),
  ).toBeNull();
});

test("bounds query size and rejects non-string query values", () => {
  expect(
    parseInspectorReadRequest({
      method: "GET",
      path: "/api/v1/runs",
      query: { agentId: "support", limit: "50" },
    }),
  ).not.toBeNull();
  expect(
    parseInspectorReadRequest({
      method: "GET",
      path: "/api/v1/runs",
      query: { agentId: { agents: "*" } },
    }),
  ).toBeNull();
  expect(
    parseInspectorReadRequest({
      method: "GET",
      path: "/api/v1/runs",
      query: { cursor: "x".repeat(9000) },
    }),
  ).toBeNull();
});
