import { describe, expect, it } from "vitest";
import { MemoryStore } from "@copilotkit/channels-core";
import { ResendThreadStore } from "../thread-store.js";
import {
  formatMailbox,
  headerSafe,
  normalizeMessageId,
  parseMailbox,
  parseMessageIds,
  replyHeaders,
  replySubject,
  trimReferences,
  MAX_REFERENCES,
} from "../threading.js";

describe("parseMailbox", () => {
  it("parses a name and an address", () => {
    expect(parseMailbox('"Ann Lee" <ann@example.com>')).toEqual({
      address: "ann@example.com",
      name: "Ann Lee",
    });
    expect(parseMailbox("Ann <ann@example.com>")).toEqual({
      address: "ann@example.com",
      name: "Ann",
    });
    expect(parseMailbox("ann@example.com")).toEqual({
      address: "ann@example.com",
    });
  });

  it("refuses values that are not one plain address", () => {
    expect(parseMailbox("not an address")).toBeUndefined();
    expect(parseMailbox("a@b.com, c@d.com")).toBeUndefined();
    expect(parseMailbox("<a@b.com>\r\nBcc: evil@x.com")).toBeUndefined();
    expect(parseMailbox(undefined)).toBeUndefined();
  });
});

describe("formatMailbox", () => {
  it("quotes the name and strips characters that break the header", () => {
    expect(
      formatMailbox({ address: "a@b.com", name: 'Eve "x"\r\nBcc: z@z.com' }),
    ).toBe('"Eve x Bcc: z@z.com" <a@b.com>');
  });
});

describe("Message-ID parsing", () => {
  it("reads ids in order without duplicates", () => {
    expect(parseMessageIds("<a@x> <b@x>\r\n <a@x> <c@x>")).toEqual([
      "<a@x>",
      "<b@x>",
      "<c@x>",
    ]);
  });

  it("drops anything that is not a <...> token, so CR/LF cannot pass", () => {
    expect(parseMessageIds("<a@x>\r\nBcc: evil@x.com")).toEqual(["<a@x>"]);
    expect(parseMessageIds(["<a@x>", "<b@x>"])).toEqual(["<a@x>", "<b@x>"]);
    expect(parseMessageIds(undefined)).toEqual([]);
  });

  it("normalizes one id", () => {
    expect(normalizeMessageId("a@x")).toBe("<a@x>");
    expect(normalizeMessageId("<a@x>")).toBe("<a@x>");
    expect(normalizeMessageId("<a@x>\r\nX: y")).toBeUndefined();
  });

  it("keeps the root and the newest references when trimming", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `<m${i}@x>`);
    const trimmed = trimReferences(ids);
    expect(trimmed).toHaveLength(MAX_REFERENCES);
    expect(trimmed[0]).toBe("<m0@x>");
    expect(trimmed.at(-1)).toBe("<m29@x>");
  });
});

describe("reply headers and subject", () => {
  it("answers the parent and appends it to References", () => {
    expect(replyHeaders("<p@x>", ["<root@x>"])).toEqual({
      inReplyTo: "<p@x>",
      references: ["<root@x>", "<p@x>"],
    });
  });

  it("adds Re: once", () => {
    expect(replySubject("Refund")).toBe("Re: Refund");
    expect(replySubject("RE: Refund")).toBe("RE: Refund");
    expect(replySubject("")).toBe("Re: (no subject)");
  });

  it("removes CR/LF from the subject (header injection)", () => {
    expect(replySubject("Hi\r\nBcc: victim@example.com")).toBe(
      "Re: Hi Bcc: victim@example.com",
    );
    expect(headerSafe("a\u0000b\nc")).toBe("a b c");
  });
});

describe("ResendThreadStore.resolveConversation", () => {
  it("uses the email's own Message-ID for a new thread", async () => {
    const threads = new ResendThreadStore(new MemoryStore());
    await expect(
      threads.resolveConversation({
        messageId: "<new@x>",
        inReplyTo: [],
        references: [],
      }),
    ).resolves.toBe("resend:new@x");
  });

  it("uses the first References id as the root of a reply", async () => {
    const threads = new ResendThreadStore(new MemoryStore());
    await expect(
      threads.resolveConversation({
        messageId: "<r2@x>",
        inReplyTo: ["<r1@x>"],
        references: ["<root@x>", "<r1@x>"],
      }),
    ).resolves.toBe("resend:root@x");
  });

  it("falls back to In-Reply-To when References is missing", async () => {
    const threads = new ResendThreadStore(new MemoryStore());
    await expect(
      threads.resolveConversation({
        messageId: "<r@x>",
        inReplyTo: ["<p@x>"],
        references: [],
      }),
    ).resolves.toBe("resend:p@x");
  });

  it("maps a reply to a known message onto that message's thread", async () => {
    const threads = new ResendThreadStore(new MemoryStore());
    await threads.rememberMessage("<second@x>", "resend:root@x");
    // A client that sends only In-Reply-To (no References) still lands in the thread.
    await expect(
      threads.resolveConversation({
        messageId: "<third@x>",
        inReplyTo: ["<second@x>"],
        references: [],
      }),
    ).resolves.toBe("resend:root@x");
    // A reply whose References were cut short also lands there.
    await expect(
      threads.resolveConversation({
        messageId: "<fourth@x>",
        inReplyTo: ["<unknown-bot-reply@resend>"],
        references: ["<second@x>", "<unknown-bot-reply@resend>"],
      }),
    ).resolves.toBe("resend:root@x");
  });

  it("returns undefined when the email has no ids at all", async () => {
    const threads = new ResendThreadStore(new MemoryStore());
    await expect(
      threads.resolveConversation({ inReplyTo: [], references: [] }),
    ).resolves.toBeUndefined();
  });
});
