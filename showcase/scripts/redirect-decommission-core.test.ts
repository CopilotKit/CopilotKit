import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  computeRedirectDecommission,
  type EventCount,
  type RedirectDecommissionInput,
  type RedirectEntryLite,
} from "./redirect-decommission-core";
import * as seoRedirectsModule from "../shell/src/lib/seo-redirects";

const seoRedirects: RedirectEntryLite[] = ((
  seoRedirectsModule as { seoRedirects?: RedirectEntryLite[] }
).seoRedirects ??
  (
    seoRedirectsModule as unknown as {
      default?: { seoRedirects?: RedirectEntryLite[] };
    }
  ).default?.seoRedirects ??
  []) as RedirectEntryLite[];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixture directory is owned by the showcase-ops package so the cross-check
// golden ships alongside the driver tests that also consume it. The core
// tests reach out to the ops tree rather than duplicate the fixture — one
// source of truth for "what the CLI printed" keeps both sides honest.
const FIXTURES = path.resolve(
  __dirname,
  "..",
  "ops",
  "test",
  "fixtures",
  "redirect-decommission",
);

const SAMPLE_REDIRECTS: RedirectEntryLite[] = [
  { id: "A1", source: "/a-old", destination: "/a" },
  { id: "A2", source: "/a2-old", destination: "/a2" },
  { id: "A3", source: "/a3-old", destination: "/a3" },
];

describe("computeRedirectDecommission", () => {
  describe("happy path — with candidates", () => {
    it("returns hasCandidates=true and a body when redirects have zero hits", () => {
      const input: RedirectDecommissionInput = {
        events: [
          { redirect_id: "A1", count: 10 },
          // A2 + A3 have no events → decommission candidates
        ],
        redirects: SAMPLE_REDIRECTS,
        days: 30,
        slackFormat: false,
      };
      const result = computeRedirectDecommission(input);

      expect(result.hasCandidates).toBe(true);
      expect(result.candidateCount).toBe(2);
      expect(result.body).toContain("Zero-hit candidates: 2");
      expect(result.body).toContain("A2");
      expect(result.body).toContain("A3");
    });

    it("returns hasCandidates=true with Slack formatting for 3 candidates", () => {
      const input: RedirectDecommissionInput = {
        events: [],
        redirects: SAMPLE_REDIRECTS,
        days: 30,
        slackFormat: true,
      };
      const result = computeRedirectDecommission(input);

      expect(result.hasCandidates).toBe(true);
      expect(result.candidateCount).toBe(3);
      expect(result.body).toContain(
        ":warning: *3 redirect(s) with zero hits",
      );
      expect(result.body).toContain(":bar_chart:");
    });

    it("groups candidates by prefix when >3 share a prefix in Slack mode", () => {
      const redirects: RedirectEntryLite[] = [
        { id: "S1×langgraph", source: "/s1/lg", destination: "/x/lg" },
        { id: "S1×adk", source: "/s1/adk", destination: "/x/adk" },
        { id: "S1×agno", source: "/s1/agno", destination: "/x/agno" },
        {
          id: "S1×crewai-flows",
          source: "/s1/crewai",
          destination: "/x/crewai",
        },
        { id: "S1×mastra", source: "/s1/mastra", destination: "/x/mastra" },
      ];
      const result = computeRedirectDecommission({
        events: [],
        redirects,
        days: 30,
        slackFormat: true,
      });
      expect(result.body).toContain("S1: 5 entries");
    });
  });

  describe("zero candidates", () => {
    it("returns hasCandidates=false with the 'all received traffic' line in Slack mode", () => {
      const input: RedirectDecommissionInput = {
        events: [
          { redirect_id: "A1", count: 1 },
          { redirect_id: "A2", count: 2 },
          { redirect_id: "A3", count: 3 },
        ],
        redirects: SAMPLE_REDIRECTS,
        days: 30,
        slackFormat: true,
      };
      const result = computeRedirectDecommission(input);

      expect(result.hasCandidates).toBe(false);
      expect(result.candidateCount).toBe(0);
      expect(result.body).toContain(
        ":white_check_mark: All redirects received traffic",
      );
    });

    it("returns hasCandidates=false with no candidate block in human mode", () => {
      const result = computeRedirectDecommission({
        events: [
          { redirect_id: "A1", count: 1 },
          { redirect_id: "A2", count: 2 },
          { redirect_id: "A3", count: 3 },
        ],
        redirects: SAMPLE_REDIRECTS,
        days: 30,
        slackFormat: false,
      });
      expect(result.hasCandidates).toBe(false);
      expect(result.body).toContain("Zero-hit candidates: 0");
      expect(result.body).not.toContain("Decommission candidates (zero hits):");
    });

    it("returns hasCandidates=false when redirects array is empty", () => {
      const result = computeRedirectDecommission({
        events: [],
        redirects: [],
        days: 30,
        slackFormat: false,
      });
      expect(result.hasCandidates).toBe(false);
      expect(result.candidateCount).toBe(0);
      expect(result.body).toContain("Total redirects defined: 0");
    });
  });

  describe("malformed input", () => {
    it("throws when input is null", () => {
      expect(() =>
        computeRedirectDecommission(null as unknown as RedirectDecommissionInput),
      ).toThrow(/input must be an object/);
    });

    it("throws when events is not an array", () => {
      expect(() =>
        computeRedirectDecommission({
          events: "not-an-array",
          redirects: [],
          days: 30,
          slackFormat: false,
        } as unknown as RedirectDecommissionInput),
      ).toThrow(/events must be an array/);
    });

    it("throws when redirects is not an array", () => {
      expect(() =>
        computeRedirectDecommission({
          events: [],
          redirects: "not-an-array",
          days: 30,
          slackFormat: false,
        } as unknown as RedirectDecommissionInput),
      ).toThrow(/redirects must be an array/);
    });

    it("throws when days is not a finite number", () => {
      expect(() =>
        computeRedirectDecommission({
          events: [],
          redirects: [],
          days: Number.NaN,
          slackFormat: false,
        } as RedirectDecommissionInput),
      ).toThrow(/days must be a finite number/);
    });

    it("throws when slackFormat is not a boolean", () => {
      expect(() =>
        computeRedirectDecommission({
          events: [],
          redirects: [],
          days: 30,
          slackFormat: "yes",
        } as unknown as RedirectDecommissionInput),
      ).toThrow(/slackFormat must be a boolean/);
    });
  });

  describe("top 10 formatting", () => {
    it("truncates the displayed list to 10 even when more events are present", () => {
      const many: EventCount[] = Array.from({ length: 15 }, (_, i) => ({
        redirect_id: `X${i}`,
        count: 1000 - i,
      }));
      const result = computeRedirectDecommission({
        events: many,
        redirects: many.map((e) => ({
          id: e.redirect_id,
          source: "/s",
          destination: "/d",
        })),
        days: 30,
        slackFormat: false,
      });
      const top10Section = result.body.split("Top 10 most-hit redirects:")[1];
      expect(top10Section).toBeDefined();
      // Count the indented rows between "Top 10" header and the next blank line
      const rows = top10Section!
        .split("\n")
        .filter((l) => l.startsWith("  X"));
      expect(rows.length).toBe(10);
    });

    it("omits the top-10 section when no events are present", () => {
      const result = computeRedirectDecommission({
        events: [],
        redirects: SAMPLE_REDIRECTS,
        days: 30,
        slackFormat: false,
      });
      expect(result.body).not.toContain("Top 10 most-hit redirects");
    });
  });

  describe("cross-check against legacy CLI stdout (byte-for-byte)", () => {
    // Guardrail: drive the EXACT same input through `computeRedirectDecommission`
    // that the legacy CLI consumes via `--events-json`, and assert the rendered
    // `body` equals the committed CLI stdout. If this diff ever fails, either
    // the core module or the CLI has drifted — both paths MUST stay in lock
    // step because both are consumed by downstream alerts/writers.
    const eventsJsonPath = path.join(FIXTURES, "events.json");
    const events = JSON.parse(
      readFileSync(eventsJsonPath, "utf8"),
    ) as EventCount[];

    it("slack-mode body matches cli-stdout.txt byte-for-byte", () => {
      const cliStdout = readFileSync(
        path.join(FIXTURES, "cli-stdout.txt"),
        "utf8",
      );
      // CLI goes through console.log → trailing newline. Core returns the body
      // without a trailing newline.
      const expected = cliStdout.endsWith("\n")
        ? cliStdout.slice(0, -1)
        : cliStdout;
      const { body } = computeRedirectDecommission({
        events,
        redirects: seoRedirects,
        days: 30,
        slackFormat: true,
      });
      expect(body).toBe(expected);
    });

    it("human-mode body matches cli-stdout-human.txt byte-for-byte", () => {
      const cliStdout = readFileSync(
        path.join(FIXTURES, "cli-stdout-human.txt"),
        "utf8",
      );
      const expected = cliStdout.endsWith("\n")
        ? cliStdout.slice(0, -1)
        : cliStdout;
      const { body } = computeRedirectDecommission({
        events,
        redirects: seoRedirects,
        days: 30,
        slackFormat: false,
      });
      expect(body).toBe(expected);
    });
  });
});
