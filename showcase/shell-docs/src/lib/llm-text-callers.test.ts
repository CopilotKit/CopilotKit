import { describe, expect, it } from "vitest";
import { classifyLlmTextCaller } from "./llm-text-callers";

// The raw Markdown surface is public, so a training crawler and a developer's
// coding agent are the same row until the user agent is read. These tests pin
// the distinctions the reporting actually rests on.
describe("classifyLlmTextCaller", () => {
  it("identifies coding agents, the class that means the surface is working", () => {
    expect(classifyLlmTextCaller("claude-code/1.2.0").class).toBe(
      "coding_agent",
    );
    expect(classifyLlmTextCaller("Cursor/0.42.3 (darwin)").class).toBe(
      "coding_agent",
    );
    expect(classifyLlmTextCaller("aider/0.60.1").agent).toBe("aider");
  });

  it("separates an assistant fetching for a human from one crawling for training", () => {
    // Both are Anthropic, one token apart, and they mean opposite things: the
    // first is a person asking right now, the second is corpus collection.
    expect(classifyLlmTextCaller("Claude-User/1.0").class).toBe(
      "ai_user_fetch",
    );
    expect(classifyLlmTextCaller("ClaudeBot/1.0").class).toBe("ai_crawler");
    expect(classifyLlmTextCaller("ChatGPT-User/1.0").class).toBe(
      "ai_user_fetch",
    );
    expect(classifyLlmTextCaller("GPTBot/1.1").class).toBe("ai_crawler");
  });

  it("classifies crawlers that impersonate a browser as crawlers", () => {
    // Nearly every crawler claims Mozilla/5.0 and a Safari token. If the
    // generic browser shape were tested first, the entire crawler population
    // would be reported as human traffic.
    const googlebot =
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/119.0.0.0 Safari/537.36";
    expect(classifyLlmTextCaller(googlebot).class).toBe("search_crawler");

    const gptbot =
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot";
    expect(classifyLlmTextCaller(gptbot).class).toBe("ai_crawler");
  });

  it("honours the bot/crawler/spider convention for crawlers it has never seen", () => {
    const unlisted =
      "Mozilla/5.0 (compatible; SomeNewAIBot/0.1; +https://example.com/bot)";
    expect(classifyLlmTextCaller(unlisted)).toEqual({
      class: "ai_crawler",
      agent: "unlisted_bot",
    });
  });

  it("recognises a real browser by shape rather than by listing every build", () => {
    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(classifyLlmTextCaller(chrome).class).toBe("browser");
  });

  it("buckets bare HTTP clients as scripts", () => {
    expect(classifyLlmTextCaller("curl/8.4.0").class).toBe("script");
    expect(classifyLlmTextCaller("python-requests/2.31.0").class).toBe(
      "script",
    );
    expect(classifyLlmTextCaller("node-fetch/3.3.2").class).toBe("script");
  });

  it("is total: an absent or unreadable user agent gets its own bucket, not a guess", () => {
    // A public file gets plenty of both, and forcing them into a real class
    // would quietly inflate whichever class absorbed them.
    expect(classifyLlmTextCaller(null)).toEqual({
      class: "unknown",
      agent: "absent",
    });
    expect(classifyLlmTextCaller("   ")).toEqual({
      class: "unknown",
      agent: "absent",
    });
    expect(classifyLlmTextCaller("something-nobody-has-shipped")).toEqual({
      class: "unknown",
      agent: "unrecognised",
    });
  });

  it("matches case-insensitively", () => {
    expect(classifyLlmTextCaller("CLAUDE-CODE/1.0").class).toBe("coding_agent");
  });

  it("does not promote a Microsoft assistant agent into coding_agent", () => {
    // "copilot" alone also appears in Microsoft assistant/crawler agents, and
    // the coding-agent rules are tested ahead of the crawler block, so a loose
    // match would inflate the single class this metric exists to count.
    expect(classifyLlmTextCaller("Microsoft Copilot Bot/1.0").class).toBe(
      "ai_crawler",
    );
    expect(classifyLlmTextCaller("github-copilot/1.0").class).toBe(
      "coding_agent",
    );
  });
});
