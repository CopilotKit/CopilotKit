import { describe, it, expect, vi } from "vitest";
import {
  parseNotionCell,
  toSlug,
  parseNotionData,
  type ParsedCell,
  type SeedEntry,
} from "../baseline-parse";

/* ------------------------------------------------------------------ */
/*  parseNotionCell                                                    */
/* ------------------------------------------------------------------ */

describe("parseNotionCell", () => {
  it("parses ✅ as works with no tags", () => {
    expect(parseNotionCell("✅")).toEqual<ParsedCell>({
      status: "works",
      tags: [],
    });
  });

  it("parses 🛠️ [DEMO] as possible with demo tag", () => {
    expect(parseNotionCell("🛠️ [DEMO]")).toEqual<ParsedCell>({
      status: "possible",
      tags: ["demo"],
    });
  });

  it("parses 🛠️ [DEMO] [DOCS] [TEST] as possible with three tags", () => {
    expect(parseNotionCell("🛠️ [DEMO] [DOCS] [TEST]")).toEqual<ParsedCell>({
      status: "possible",
      tags: ["demo", "docs", "tests"],
    });
  });

  it("parses 🛠️ [ALL] as possible with all tag", () => {
    expect(parseNotionCell("🛠️ [ALL]")).toEqual<ParsedCell>({
      status: "possible",
      tags: ["all"],
    });
  });

  it("parses ❌ as impossible with no tags", () => {
    expect(parseNotionCell("❌")).toEqual<ParsedCell>({
      status: "impossible",
      tags: [],
    });
  });

  it("parses ❌ [INT] as impossible with int tag", () => {
    expect(parseNotionCell("❌ [INT]")).toEqual<ParsedCell>({
      status: "impossible",
      tags: ["int"],
    });
  });

  it("parses ❓ as unknown with no tags", () => {
    expect(parseNotionCell("❓")).toEqual<ParsedCell>({
      status: "unknown",
      tags: [],
    });
  });

  it("parses empty string as unknown with no tags", () => {
    expect(parseNotionCell("")).toEqual<ParsedCell>({
      status: "unknown",
      tags: [],
    });
  });

  it("parses free text as unknown and warns", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseNotionCell("Doesn't work:\n• A2UI")).toEqual<ParsedCell>({
      status: "unknown",
      tags: [],
    });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("parses 🛠️ [CPK] [AG-UI] as possible with cpk and agui tags", () => {
    expect(parseNotionCell("🛠️ [CPK] [AG-UI]")).toEqual<ParsedCell>({
      status: "possible",
      tags: ["cpk", "agui"],
    });
  });

  it("parses 🛠️ [INT] with trailing space correctly", () => {
    expect(parseNotionCell("🛠️ [INT] ")).toEqual<ParsedCell>({
      status: "possible",
      tags: ["int"],
    });
  });

  it("defaults 🛠️ with no tags to [all]", () => {
    expect(parseNotionCell("🛠️")).toEqual<ParsedCell>({
      status: "possible",
      tags: ["all"],
    });
  });

  it("handles 🛠 without variation selector", () => {
    expect(parseNotionCell("🛠 [DEMO]")).toEqual<ParsedCell>({
      status: "possible",
      tags: ["demo"],
    });
  });

  it("deduplicates [TEST] and [TESTS] to a single tests tag", () => {
    expect(parseNotionCell("🛠️ [TEST] [TESTS]")).toEqual<ParsedCell>({
      status: "possible",
      tags: ["tests"],
    });
  });
});

/* ------------------------------------------------------------------ */
/*  toSlug                                                             */
/* ------------------------------------------------------------------ */

describe("toSlug", () => {
  it("converts Beautiful Chat to kebab-case", () => {
    expect(toSlug("Beautiful Chat")).toBe("beautiful-chat");
  });

  it("strips parentheses and collapses", () => {
    expect(toSlug("Shared State (Read + Write)")).toBe(
      "shared-state-read-write",
    );
  });

  it("uses override for MAF - .Net", () => {
    expect(toSlug("MAF - .Net")).toBe("maf-dotnet");
  });

  it("uses override for MAF - Python", () => {
    expect(toSlug("MAF - Python")).toBe("maf-python");
  });

  it("converts LangChain - Python to langchain-python", () => {
    expect(toSlug("LangChain - Python")).toBe("langchain-python");
  });

  it("converts Claude Agents SDK - TS", () => {
    expect(toSlug("Claude Agents SDK - TS")).toBe("claude-agents-sdk-ts");
  });

  it("handles em dashes", () => {
    expect(toSlug("Foo — Bar")).toBe("foo-bar");
  });

  it("strips dots in names without override", () => {
    expect(toSlug("Some.Thing")).toBe("something");
  });

  it("strips ampersands", () => {
    expect(toSlug("Chat & UI")).toBe("chat-ui");
  });
});

/* ------------------------------------------------------------------ */
/*  parseNotionData                                                    */
/* ------------------------------------------------------------------ */

describe("parseNotionData", () => {
  it("iterates rows × partners to produce SeedEntries", () => {
    const rows = [
      {
        "Feature / Capability": "Beautiful Chat",
        "LangChain - Python": "✅",
        Cloudflare: "🛠️ [ALL]",
      },
      {
        "Feature / Capability": "Shared State (Read + Write)",
        "LangChain - Python": "🛠️ [DEMO]",
        Cloudflare: "❌ [INT]",
      },
    ];
    const partners = ["LangChain - Python", "Cloudflare"];

    const result = parseNotionData(rows, partners);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual<SeedEntry>({
      partnerSlug: "langchain-python",
      featureSlug: "beautiful-chat",
      status: "works",
      tags: [],
    });
    expect(result[1]).toEqual<SeedEntry>({
      partnerSlug: "cloudflare",
      featureSlug: "beautiful-chat",
      status: "possible",
      tags: ["all"],
    });
    expect(result[2]).toEqual<SeedEntry>({
      partnerSlug: "langchain-python",
      featureSlug: "shared-state-read-write",
      status: "possible",
      tags: ["demo"],
    });
    expect(result[3]).toEqual<SeedEntry>({
      partnerSlug: "cloudflare",
      featureSlug: "shared-state-read-write",
      status: "impossible",
      tags: ["int"],
    });
  });

  it("skips rows without Feature / Capability", () => {
    const rows = [
      { "LangChain - Python": "✅" }, // missing feature name
    ];
    const result = parseNotionData(rows, ["LangChain - Python"]);
    expect(result).toHaveLength(0);
  });

  it("treats missing partner cell as empty (unknown)", () => {
    const rows = [
      {
        "Feature / Capability": "Test Feature",
        // no Cloudflare key
      },
    ];
    const result = parseNotionData(rows, ["Cloudflare"]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("unknown");
    expect(result[0].tags).toEqual([]);
  });
});
