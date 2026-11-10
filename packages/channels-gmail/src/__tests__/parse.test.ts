import { describe, expect, it } from "vitest";
import {
  decodeHeaderText,
  htmlToText,
  parseAddress,
  parseGmailMessage,
  stripQuotedReply,
} from "../parse.js";
import { gmailMessage } from "./fake-gmail.js";

describe("stripQuotedReply", () => {
  it("cuts Gmail's 'On … wrote:' history", () => {
    const text = [
      "Sounds good, ship it.",
      "",
      "On Mon, Jan 1, 2024 at 10:00 AM Bot <bot@example.com> wrote:",
      "> Should I deploy?",
      ">",
      "> Thanks",
    ].join("\r\n");
    expect(stripQuotedReply(text)).toBe("Sounds good, ship it.");
  });

  it("cuts an 'On … wrote:' line that wraps", () => {
    const text = [
      "Yes please.",
      "",
      "On Mon, Jan 1, 2024 at 10:00 AM A Very Long Name <someone@example.com>",
      "wrote:",
      "> earlier",
    ].join("\n");
    expect(stripQuotedReply(text)).toBe("Yes please.");
  });

  it("cuts Outlook history", () => {
    expect(
      stripQuotedReply(
        "Approved.\n\n-----Original Message-----\nFrom: Bot\nSent: today\n\nold",
      ),
    ).toBe("Approved.");
    expect(
      stripQuotedReply(
        "Approved.\n\nFrom: Bot <bot@example.com>\nSent: Monday\nTo: me\nSubject: x\n\nold",
      ),
    ).toBe("Approved.");
    expect(
      stripQuotedReply("Approved.\n________________________________\nold"),
    ).toBe("Approved.");
  });

  it("drops quoted lines in the middle and the signature", () => {
    const text = [
      "> question one",
      "Answer one.",
      "> question two",
      "Answer two.",
      "",
      "-- ",
      "Jane Doe",
      "ACME Corp",
    ].join("\n");
    expect(stripQuotedReply(text)).toBe("Answer one.\nAnswer two.");
  });

  it("keeps text that only mentions 'On'", () => {
    expect(stripQuotedReply("On Friday we ship.\nThanks")).toBe(
      "On Friday we ship.\nThanks",
    );
  });
});

describe("htmlToText", () => {
  it("removes tags, styles, and Gmail quote blocks", () => {
    const html =
      '<style>p{color:red}</style><div dir="ltr">Hi <b>team</b>,<br>Ship it &amp; tell me.</div>' +
      '<div class="gmail_quote"><div>On Mon … wrote:</div><blockquote>old</blockquote></div>';
    expect(htmlToText(html)).toBe("Hi team,\nShip it & tell me.");
  });

  it("decodes numeric entities", () => {
    expect(htmlToText("<p>caf&#233; &#x2713;</p>")).toBe("café ✓");
  });
});

describe("header parsing", () => {
  it("decodes RFC 2047 words", () => {
    expect(
      decodeHeaderText("=?UTF-8?B?R3LDvMOfZQ==?= =?UTF-8?Q?_aus_K=C3=B6ln?="),
    ).toBe("Grüße aus Köln");
  });

  it("parses addresses with and without a name", () => {
    expect(parseAddress('"Jane Doe" <Jane@Example.org>')).toEqual({
      address: "jane@example.org",
      name: "Jane Doe",
    });
    expect(parseAddress("jane@example.org")).toEqual({
      address: "jane@example.org",
    });
    expect(parseAddress("not an address")).toEqual({ address: "" });
  });
});

describe("parseGmailMessage", () => {
  it("reads the sender, threading headers, body, and attachments", () => {
    const email = parseGmailMessage(
      gmailMessage({
        id: "m1",
        threadId: "t1",
        from: "Jane <jane@example.org>",
        replyTo: "team@example.org",
        subject: "Report",
        references: "<a@x> <b@x>",
        text: "See attached.\n\nOn Mon Bot wrote:\n> old",
        attachments: [
          {
            filename: "a.png",
            mimeType: "image/png",
            bytes: Buffer.from("png"),
          },
        ],
      }),
    );
    expect(email).toMatchObject({
      id: "m1",
      threadId: "t1",
      fromAddress: "jane@example.org",
      fromName: "Jane",
      replyTo: "team@example.org",
      subject: "Report",
      rfcMessageId: "<m1@mail.example.com>",
      references: ["<a@x>", "<b@x>"],
      text: "See attached.",
      automatic: false,
    });
    expect(email.attachments).toEqual([
      expect.objectContaining({
        filename: "a.png",
        mimeType: "image/png",
        size: 3,
      }),
    ]);
  });

  it("falls back to the HTML body", () => {
    const email = parseGmailMessage(
      gmailMessage({
        id: "m",
        threadId: "t",
        from: "a@b.co",
        html: "<p>Hi there</p>",
      }),
    );
    expect(email.text).toBe("Hi there");
  });

  it("marks automatic mail", () => {
    const auto = (headers: Record<string, string>) =>
      parseGmailMessage(
        gmailMessage({
          id: "m",
          threadId: "t",
          from: "a@b.co",
          text: "x",
          headers,
        }),
      ).automatic;
    expect(auto({ "Auto-Submitted": "auto-replied" })).toBe(true);
    expect(auto({ "Auto-Submitted": "no" })).toBe(false);
    expect(auto({ Precedence: "bulk" })).toBe(true);
    expect(auto({})).toBe(false);
  });
});
