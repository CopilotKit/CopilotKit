import { describe, expect, it } from "vitest";
import {
  buildReplyMime,
  encodeHeaderText,
  formatAddress,
  replySubject,
} from "../mime.js";
import { leaves, parseMime, partOfType } from "./fake-gmail.js";

const base = {
  from: "bot@example.com",
  to: "jane@example.org",
  subject: "Invoice question",
  text: "Plain body",
  html: "<p>HTML body</p>",
};

describe("buildReplyMime", () => {
  it("threads the reply under the original email", () => {
    const mime = parseMime(
      buildReplyMime({
        ...base,
        inReplyTo: "<orig@mail.example.org>",
        references: ["<first@mail.example.org>"],
      }),
    );
    expect(mime.headers.get("subject")).toBe("Re: Invoice question");
    expect(mime.headers.get("in-reply-to")).toBe("<orig@mail.example.org>");
    expect(mime.headers.get("references")).toBe(
      "<first@mail.example.org> <orig@mail.example.org>",
    );
    expect(mime.headers.get("to")).toBe("jane@example.org");
    expect(mime.headers.get("auto-submitted")).toBe("auto-replied");
  });

  it("does not stack a second Re: or repeat the parent in References", () => {
    const mime = parseMime(
      buildReplyMime({
        ...base,
        subject: "RE: Invoice question",
        inReplyTo: "<orig@x>",
        references: ["<orig@x>"],
      }),
    );
    expect(mime.headers.get("subject")).toBe("RE: Invoice question");
    expect(mime.headers.get("references")).toBe("<orig@x>");
  });

  it("sends text and HTML as multipart/alternative", () => {
    const mime = parseMime(buildReplyMime(base));
    expect(mime.headers.get("content-type")).toMatch(/^multipart\/alternative/);
    expect(partOfType(mime, "text/plain")?.body.toString()).toBe("Plain body");
    expect(partOfType(mime, "text/html")?.body.toString()).toBe(
      "<p>HTML body</p>",
    );
  });

  it("wraps the body and attachments in multipart/mixed", () => {
    const bytes = Buffer.from("%PDF-1.4 fake");
    const mime = parseMime(
      buildReplyMime({
        ...base,
        attachments: [
          { filename: "report.pdf", contentType: "application/pdf", bytes },
        ],
      }),
    );
    expect(mime.headers.get("content-type")).toMatch(/^multipart\/mixed/);
    expect(mime.parts[0]!.headers.get("content-type")).toMatch(
      /^multipart\/alternative/,
    );
    const file = leaves(mime).find((p) =>
      p.headers.get("content-disposition")?.startsWith("attachment"),
    )!;
    expect(file.headers.get("content-type")).toBe(
      'application/pdf; name="report.pdf"',
    );
    expect(file.headers.get("content-disposition")).toBe(
      'attachment; filename="report.pdf"',
    );
    expect(file.body.equals(bytes)).toBe(true);
  });

  it("encodes a non-ASCII file name with RFC 2231", () => {
    const mime = parseMime(
      buildReplyMime({
        ...base,
        attachments: [
          {
            filename: "résumé.txt",
            contentType: "text/plain",
            bytes: Buffer.from("x"),
          },
        ],
      }),
    );
    const file = leaves(mime).at(-1)!;
    expect(file.headers.get("content-disposition")).toBe(
      `attachment; filename="r_sum_.txt"; filename*=UTF-8''r%C3%A9sum%C3%A9.txt`,
    );
  });

  it("keeps caller data from adding headers", () => {
    const raw = buildReplyMime({
      ...base,
      fromName: 'Bot"\r\nBcc: evil@attacker.test',
      subject: "Hi\r\nBcc: evil@attacker.test",
      inReplyTo: "<a@b>\r\nBcc: evil@attacker.test",
      references: ["<ok@x>", "<bad@x>\r\nX-Evil: 1"],
      attachments: [
        {
          filename: 'a"\r\nX-Evil: 1.txt',
          contentType: "text/plain\r\nX-Evil: 1",
          bytes: Buffer.from("x"),
        },
      ],
    }).toString("latin1");
    const head = raw.slice(0, raw.indexOf("\r\n\r\n"));
    expect(head).not.toMatch(/^Bcc:/im);
    expect(raw).not.toMatch(/^X-Evil:/im);
    const mime = parseMime(raw);
    expect(mime.headers.has("in-reply-to")).toBe(false);
    expect(mime.headers.get("subject")).toBe("Re: Hi Bcc: evil@attacker.test");
    const file = leaves(mime).at(-1)!;
    expect(file.headers.get("content-type")).toMatch(
      /^application\/octet-stream;/,
    );
  });

  it("rejects an invalid recipient address", () => {
    expect(() =>
      buildReplyMime({ ...base, to: "jane@example.org\r\nBcc: x@y.z" }),
    ).toThrow(/not a valid email address/);
    expect(() => buildReplyMime({ ...base, to: "a@b.c, other@d.e" })).toThrow(
      /not a valid email address/,
    );
  });
});

describe("header helpers", () => {
  it("encodes non-ASCII header text as RFC 2047 words", () => {
    const encoded = encodeHeaderText("Grüße aus Köln");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    const decoded = encoded
      .split(" ")
      .map((w) => Buffer.from(w.slice(10, -2), "base64").toString())
      .join("");
    expect(decoded).toBe("Grüße aus Köln");
  });

  it("quotes and escapes a display name", () => {
    expect(formatAddress("bot@example.com", 'Help "Desk"')).toBe(
      '"Help \\"Desk\\"" <bot@example.com>',
    );
  });

  it("builds a reply subject", () => {
    expect(replySubject("")).toBe("Re:");
    expect(replySubject("Hello")).toBe("Re: Hello");
    expect(replySubject("re: Hello")).toBe("re: Hello");
  });
});
