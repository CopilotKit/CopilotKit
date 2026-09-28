import { describe, expect, it, vi } from "vitest";
import { sanitizeRequestBody, sanitizeResponseBody } from "./request-data";
import { createObjectReferences } from "./references";

const brokenHints: Iterable<string> = {
  [Symbol.iterator](): Iterator<string> {
    throw new Error("unavailable");
  },
};

describe("bounded request JSON fields", () => {
  it("retains ordinary structured business fields and exact task prose", () => {
    const fields = {
      deliverySpeed: "express",
      dispatchNote: "Please hold until the review is complete.",
      confirmed: true,
      pickupWindow: "morning",
      options: { retries: 2, tags: ["review", "fragile"] },
      fallback: null,
    };
    expect(sanitizeRequestBody(JSON.stringify(fields))).toEqual({
      fields,
      omittedFieldCount: 0,
    });
  });

  it.each([
    "customerEmail",
    "fullName",
    "name",
    "shippingAddress",
    "customerPhone",
    "accessCode",
    "privateComment",
    "internalMemo",
    "accessToken",
    "authorization",
    "session",
    "cookies",
    "credentials",
    "card",
    "id",
    "customerId",
    "customerID",
    "customer_id",
    "apiKey",
    "Ｅｍａｉｌ",
    "e\u200bmail",
    "%65mail",
    "%2565mail",
  ])("omits the whole sensitive field and its raw key: %s", (key) => {
    const result = sanitizeRequestBody(
      JSON.stringify({ deliverySpeed: "express", [key]: "private canary" }),
    );
    expect(result).toEqual({
      fields: { deliverySpeed: "express" },
      omittedFieldCount: 1,
      omissionReason: "sensitive",
    });
    expect(JSON.stringify(result)).not.toContain("private canary");
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it.each([
    "Contact alice@example.com",
    "alice%40example.com",
    "alice%2540example.com",
    "alice%252540example.com",
    "Call +1 (415) 555-0123",
    "４１５５５５０１２３",
    "Password = private-value",
    "api_key: private-value",
    "Authorization: Bearer abcdefghijklmnop",
    "https://example.com/private",
    "Unexpected\u001b[31m escape",
    "9b031adefe239140ab921ec4",
    "550e8400-e29b-41d4-a716-446655440000",
  ])(
    "drops the entire field with sensitive or encoded content: %j",
    (value) => {
      expect(
        sanitizeRequestBody(
          JSON.stringify({ dispatchNote: value, confirmed: true }),
        ),
      ).toEqual({
        fields: { confirmed: true },
        omittedFieldCount: 1,
        omissionReason: "sensitive",
      });
    },
  );

  it("filters recursively, including array values and numeric personal data", () => {
    expect(
      sanitizeRequestBody(
        JSON.stringify({
          options: { pickupWindow: "morning", internalMemo: "private" },
          labels: ["fragile", "alice@example.com", { confirmed: false }],
          quantity: 4155550123,
        }),
      ),
    ).toEqual({
      fields: {
        options: { pickupWindow: "morning" },
      },
      omittedFieldCount: 3,
      omissionReason: "sensitive",
    });
  });

  it("omits arrays whole when sensitive descendants would change their structure", () => {
    expect(
      sanitizeRequestBody(
        JSON.stringify({
          columns: ["deliverySpeed", "pickupWindow"],
          values: ["express", "alice@example.com"],
          packages: [
            { deliverySpeed: "express" },
            { pickupWindow: "morning", accessCode: "private" },
          ],
          confirmed: true,
        }),
      ),
    ).toEqual({
      fields: { columns: ["deliverySpeed", "pickupWindow"], confirmed: true },
      omittedFieldCount: 2,
      omissionReason: "sensitive",
    });
  });

  it("applies normalized private-control names/IDs at every level", () => {
    expect(
      sanitizeRequestBody(
        JSON.stringify({
          dispatchNote: "private business prose",
          options: { PICKUPWINDOW: "private timing", confirmed: true },
          deliverySpeed: "express",
        }),
        new Set(["DISPATCHNOTE", "pickupwindow"]),
      ),
    ).toEqual({
      fields: { options: { confirmed: true }, deliverySpeed: "express" },
      omittedFieldCount: 2,
      omissionReason: "sensitive",
    });
  });

  it("contains prototype-like keys without changing object prototypes", () => {
    const result = sanitizeRequestBody(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":"private","confirmed":true}',
    );
    expect(result).toEqual({
      fields: { confirmed: true },
      omittedFieldCount: 3,
      omissionReason: "sensitive",
    });
    expect(Object.getPrototypeOf(result.fields)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it.each(["", "{", '{"confirmed":true} trailing', "{key:true}"])(
    "marks malformed JSON without echoing the body: %j",
    (body) => {
      expect(sanitizeRequestBody(body)).toEqual({
        omittedFieldCount: 1,
        omissionReason: "malformed",
      });
    },
  );

  it.each(["null", '"private text"', "42", "true", '["private text"]'])(
    "marks unsupported JSON roots: %s",
    (body) => {
      expect(sanitizeRequestBody(body)).toEqual({
        omittedFieldCount: 1,
        omissionReason: "unsupported",
      });
    },
  );

  it("does not inspect non-string bodies or call their methods/getters", () => {
    const body = {
      get text() {
        throw new Error("must not read");
      },
      get stream() {
        throw new Error("must not read");
      },
      get toJSON() {
        throw new Error("must not read");
      },
      get toString() {
        throw new Error("must not read");
      },
    };
    for (const unsupported of [body, new Uint8Array([1]), undefined, null]) {
      expect(sanitizeRequestBody(unsupported)).toEqual({
        omittedFieldCount: 1,
        omissionReason: "unsupported",
      });
    }
  });

  it("rejects oversized bodies as a whole, including multibyte JSON", () => {
    for (const text of ["a".repeat(16384), "界".repeat(5500)]) {
      expect(
        sanitizeRequestBody(
          JSON.stringify({ confirmed: true, dispatchNote: text }),
        ),
      ).toEqual({ omittedFieldCount: 1, omissionReason: "oversized" });
    }
  });

  it("rejects oversized values whole rather than exposing their safe-looking prefixes", () => {
    expect(
      sanitizeRequestBody(
        JSON.stringify({
          dispatchNote: "safe ".repeat(300) + "alice@example.com",
          confirmed: true,
        }),
      ),
    ).toEqual({
      fields: { confirmed: true },
      omittedFieldCount: 1,
      omissionReason: "truncated",
    });
  });

  it("limits depth and total visited fields, with explicit partial metadata", () => {
    expect(
      sanitizeRequestBody(
        '{"one":{"two":{"three":{"four":"deep private value"}}},"confirmed":true}',
      ),
    ).toEqual({
      fields: { one: { two: {} }, confirmed: true },
      omittedFieldCount: 1,
      omissionReason: "truncated",
    });
    const fields = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`field${i}`, i]),
    );
    const result = sanitizeRequestBody(JSON.stringify(fields));
    expect(Object.keys(result.fields!)).toHaveLength(20);
    expect(result.omittedFieldCount).toBeGreaterThan(0);
    expect(result.omittedFieldCountIsLowerBound).toBe(true);
    expect(result.omissionReason).toBe("truncated");
  });

  it("keeps the entire serialized result below 2 KiB without clipping values", () => {
    const value = "Review these details. ".repeat(15);
    const fields = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`field${i}`, value]),
    );
    const result = sanitizeRequestBody(JSON.stringify(fields));
    expect(
      new TextEncoder().encode(JSON.stringify(result)).byteLength,
    ).toBeLessThanOrEqual(2048);
    expect(Object.values(result.fields!)).toContain(value);
    expect(Object.values(result.fields!).every((item) => item === value)).toBe(
      true,
    );
    expect(result.omissionReason).toBe("truncated");
    expect(result.omittedFieldCount).toBeGreaterThan(0);
  });

  it("bounds private-control hint processing and fails closed on unreadable hints", () => {
    let reads = 0;
    function* infiniteHints() {
      while (true) {
        reads++;
        yield "field";
      }
    }
    expect(sanitizeRequestBody('{"confirmed":true}', infiniteHints())).toEqual({
      omittedFieldCount: 1,
      omissionReason: "truncated",
    });
    expect(reads).toBe(129);
    expect(
      sanitizeRequestBody('{"confirmed":true}', ["x".repeat(129)]),
    ).toEqual({
      omittedFieldCount: 1,
      omissionReason: "truncated",
    });
    expect(sanitizeRequestBody('{"confirmed":true}', brokenHints)).toEqual({
      omittedFieldCount: 1,
      omissionReason: "unsupported",
    });
  });
});

describe("bounded response JSON fields", () => {
  it("captures business outcomes and errors from consumed JSON and JSON text", () => {
    const body = {
      status: "needs-review",
      error: "Receipt required above the configured limit.",
      retryable: true,
      review: { decision: "pending", attempts: 2 },
    };
    for (const result of [
      sanitizeResponseBody(body, "json"),
      sanitizeResponseBody(JSON.stringify(body), "text"),
    ])
      expect(result).toEqual({ fields: body, omittedFieldCount: 0 });
  });

  it("preserves complete array positions and omits any partially observed array", () => {
    const items = [{ status: "pending" }, { status: "approved" }];
    expect(sanitizeResponseBody(items, "json")).toEqual({
      items,
      omittedFieldCount: 0,
    });
    const partial = sanitizeResponseBody(
      [{ status: "pending" }, { email: "private@example.test" }],
      "json",
    );
    expect(partial.items).toBeUndefined();
    expect(partial.omissionReason).toBe("sensitive");
    expect(JSON.stringify(partial)).not.toContain("private@example.test");
    const sparse = [];
    sparse.length = 2;
    sparse[0] = "first";
    expect(sanitizeResponseBody(sparse, "json").items).toBeUndefined();
  });

  it("uses the same private-field and content rules for responses", () => {
    const result = sanitizeResponseBody(
      {
        status: "approved",
        recipientEmail: "private@example.test",
        reviewNote: "Private business prose",
        message: "Email private@example.test",
        result: { accessToken: "private-token", confirmed: true },
      },
      "json",
      ["reviewNote"],
    );
    expect(result).toEqual({
      fields: { status: "approved", result: { confirmed: true } },
      omittedFieldCount: 4,
      omissionReason: "sensitive",
    });
    expect(JSON.stringify(result)).not.toContain("Private business prose");
  });

  it("never invokes object getters, class methods or serialization hooks", () => {
    let reads = 0;
    const payload = {
      status: "approved",
      get data() {
        reads++;
        return "private";
      },
      get toJSON() {
        reads++;
        return () => "private";
      },
    };
    expect(sanitizeResponseBody(payload, "json")).toEqual({
      fields: { status: "approved" },
      omittedFieldCount: 2,
      omissionReason: "sensitive",
    });
    expect(reads).toBe(0);
    expect(sanitizeResponseBody(new Date(), "json").fields).toBeUndefined();
  });

  it("does not capture non-JSON response text, primitive roots or oversized text", () => {
    expect(sanitizeResponseBody("Private text", "text")).toEqual({
      omittedFieldCount: 1,
      omissionReason: "malformed",
    });
    for (const value of [undefined, null, "Private text", 123, false])
      expect(sanitizeResponseBody(value, "json")).toEqual({
        omittedFieldCount: 1,
        omissionReason: "unsupported",
      });
    expect(sanitizeResponseBody("x".repeat(17000), "text")).toEqual({
      omittedFieldCount: 1,
      omissionReason: "oversized",
    });
  });

  it("bounds already-parsed responses without serializing their omitted subtrees", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `field${index}`,
        "Review these details. ".repeat(15),
      ]),
    );
    const result = sanitizeResponseBody(fields, "json");
    expect(
      new TextEncoder().encode(JSON.stringify(result)).byteLength,
    ).toBeLessThanOrEqual(2048);
    expect(result.omissionReason).toBe("truncated");
    expect(result.omittedFieldCount).toBeGreaterThan(0);
    expect(result.omittedFieldCountIsLowerBound).toBe(true);
    const circular = { data: {} };
    circular.data = circular;
    expect(sanitizeResponseBody(circular, "json").omissionReason).toBe(
      "truncated",
    );
  });

  it("rejects huge arrays before enumerating indices and stops object descriptor inspection at its budget", () => {
    const huge: unknown[] = [];
    huge.length = 1_000_000;
    Object.defineProperty(huge, "0", {
      enumerable: true,
      get() {
        throw new Error("must not read a rejected array");
      },
    });
    expect(sanitizeResponseBody(huge, "json")).toEqual({
      items: undefined,
      omittedFieldCount: 1_000_000,
      omissionReason: "truncated",
    });
    const body = Object.fromEntries(
      Array.from({ length: 1000 }, (_, index) => [`field${index}`, "safe"]),
    );
    const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
    try {
      const result = sanitizeResponseBody(body, "json");
      expect(result.omittedFieldCountIsLowerBound).toBe(true);
      expect(result.omissionReason).toBe("truncated");
      expect(Object.keys(result.fields!)).toHaveLength(20);
      expect(descriptors).toHaveBeenCalledTimes(20);
    } finally {
      descriptors.mockRestore();
    }
  });

  it("links ordinary IDs through ephemeral references and keeps sensitive IDs omitted", () => {
    const { reference } = createObjectReferences();
    const response = sanitizeResponseBody(
      {
        id: "record-48319",
        status: "created",
        privateId: "private-record",
        tokenId: "secret",
        emailId: "private@example.test",
      },
      "json",
      [],
      reference,
    );
    expect(response).toEqual({
      fields: { id: { reference: "object-1" }, status: "created" },
      omittedFieldCount: 3,
      omissionReason: "sensitive",
    });
    const request = sanitizeRequestBody(
      '{"draftId":"record-48319","confirmed":true}',
      [],
      reference,
    );
    expect(request).toEqual({
      fields: { draftId: { reference: "object-1" }, confirmed: true },
      omittedFieldCount: 0,
    });
    expect(JSON.stringify([request, response])).not.toContain("record-48319");
    expect(sanitizeRequestBody('{"draftId":"record-48319"}').fields).toEqual(
      {},
    );
    expect(sanitizeResponseBody({ id: "record-48319" }, "json").fields).toEqual(
      {},
    );
    expect(
      sanitizeResponseBody({ id: "record-48319" }, "json", ["id"], reference)
        .fields,
    ).toEqual({});
  });

  it("does not expose raw IDs when references are invalid, unavailable or throw", () => {
    for (const reference of [
      () => undefined,
      () => "private-original-id",
      () => {
        throw new Error("unavailable");
      },
    ]) {
      expect(
        sanitizeRequestBody('{"id":"private-original-id"}', [], reference),
      ).toEqual({
        fields: {},
        omittedFieldCount: 1,
        omissionReason: "sensitive",
      });
    }
  });
});
