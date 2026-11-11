// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERATIVE_UI_FUNCTIONS } from "@copilotkit/shared";
import { createGenerativeUIDispatcher } from "../dispatcher";
import {
  BASIC_FUNCTIONS,
  ExpressionError,
  PlatformError,
  openUrlSafely,
} from "../functions";
// The resolver adds calc and series to the registry.
import "../resolve";
import { RN_URL_MODELS } from "./hermes-globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fn = (name: string, args: Record<string, unknown>): any =>
  BASIC_FUNCTIONS[name]!(args);

describe("basic functions", () => {
  it("implements every built-in function that the shared list names", () => {
    const names = Object.keys(GENERATIVE_UI_FUNCTIONS);
    expect(Object.keys(BASIC_FUNCTIONS).sort()).toEqual(names.sort());
  });

  it("validates with required, regex, length, numeric and email", () => {
    expect(fn("required", { value: "" })).toEqual({
      valid: false,
      message: "Required",
      code: "required",
    });
    expect(fn("required", { value: [] }).valid).toBe(false);
    expect(fn("required", { value: 0 }).valid).toBe(true);
    expect(
      fn("regex", { value: "AB-12", pattern: "^[A-Z]{2}-\\d{2}$" }).valid,
    ).toBe(true);
    expect(fn("regex", { value: "ab", pattern: "^[A-Z]+$" }).valid).toBe(false);
    expect(fn("length", { value: "abc", min: 2, max: 3 }).valid).toBe(true);
    expect(fn("length", { value: "abcd", max: 3 })).toEqual({
      valid: false,
      message: "At most 3 characters",
      code: "tooLong",
    });
    expect(fn("length", { value: "a", min: 2 }).code).toBe("tooShort");
    expect(fn("regex", { value: "ab", pattern: "^[A-Z]+$" }).code).toBe(
      "pattern",
    );
    expect(fn("numeric", { value: "x" }).code).toBe("notANumber");
    expect(fn("numeric", { value: 0, min: 1 }).code).toBe("tooSmall");
    expect(fn("numeric", { value: 11, max: 10 }).code).toBe("tooLarge");
    expect(fn("email", { value: "a@b" }).code).toBe("email");
    expect(fn("numeric", { value: "7", min: 1, max: 10 }).valid).toBe(true);
    expect(fn("numeric", { value: "x" }).valid).toBe(false);
    expect(fn("numeric", { value: 11, max: 10 }).message).toBe("At most 10");
    expect(fn("email", { value: "a@b.co" }).valid).toBe(true);
    expect(fn("email", { value: "a@b" }).valid).toBe(false);
  });

  it("formats numbers, currency and dates", () => {
    expect(fn("formatNumber", { value: 1234567.891 })).toBe("1,234,567.891");
    expect(
      fn("formatNumber", { value: 1234.5, decimals: 2, grouping: false }),
    ).toBe("1234.50");
    expect(fn("formatCurrency", { value: 12.5, currency: "EUR" })).toBe(
      "€12.50",
    );
    expect(
      fn("formatCurrency", { value: 1200, currency: "JPY", decimals: 0 }),
    ).toBe("¥1,200");
    expect(
      fn("formatDate", { value: "2026-10-19", format: "yyyy-MM-dd" }),
    ).toBe("2026-10-19");
    expect(
      fn("formatDate", {
        value: "2026-10-19T14:05:09",
        format: "MMM d, yyyy HH:mm",
      }),
    ).toBe("Oct 19, 2026 14:05");
    expect(
      fn("formatDate", {
        value: "2026-10-19T14:05:00",
        format: "h:mm a 'o''clock'",
      }),
    ).toBe("2:05 PM o'clock");
    expect(fn("formatDate", { value: "2026-10-19", format: "EEEE" })).toBe(
      "Monday",
    );
    expect(
      fn("formatDate", { value: "2026-11-07", format: "EEE, MMM d" }),
    ).toBe("Sat, Nov 7");
    expect(
      fn("formatDate", { value: "2026-11-07", format: "d/M/yy 'at' HH:mm" }),
    ).toBe("7/11/26 at 00:00");
  });

  it("pluralizes by the locale category, with zero first", () => {
    const args = { zero: "none", one: "item", other: "items" };
    expect(fn("pluralize", { value: 0, ...args })).toBe("none");
    expect(fn("pluralize", { value: 1, ...args })).toBe("item");
    expect(fn("pluralize", { value: 5, ...args })).toBe("items");
    expect(fn("pluralize", { value: 1, other: "items" })).toBe("items");
  });

  it("rejects bad arguments with an ExpressionError", () => {
    expect(() => fn("formatCurrency", { value: 1 })).toThrow(ExpressionError);
    expect(() => fn("formatCurrency", { value: 1, currency: "nope" })).toThrow(
      "not a currency code",
    );
    expect(() => fn("formatDate", { value: "yesterday", format: "d" })).toThrow(
      "must be a date",
    );
    expect(() => fn("regex", { value: "a", pattern: "(" })).toThrow(
      "not a regular expression",
    );
    expect(() => fn("and", { values: true })).toThrow("values must be a list");
  });

  describe("without Intl.NumberFormat or Intl.DateTimeFormat", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("throws a PlatformError, not an ExpressionError, that names what is missing", () => {
      vi.stubGlobal("Intl", { PluralRules: Intl.PluralRules });
      expect(() => fn("formatNumber", { value: 1 })).toThrow(PlatformError);
      expect(() => fn("formatNumber", { value: 1 })).not.toThrow(
        ExpressionError,
      );
      expect(() => fn("formatNumber", { value: 1 })).toThrow(
        "formatNumber needs Intl.NumberFormat",
      );
      expect(() => fn("formatCurrency", { value: 1, currency: "EUR" })).toThrow(
        "formatCurrency needs Intl.NumberFormat",
      );
      expect(() =>
        fn("formatDate", { value: "2026-10-19", format: "EEEE" }),
      ).toThrow("formatDate needs Intl.DateTimeFormat");
      expect(
        fn("formatDate", { value: "2026-10-19", format: "yyyy-MM-dd" }),
      ).toBe("2026-10-19");
      vi.stubGlobal("Intl", undefined);
      expect(() => fn("formatNumber", { value: 1 })).toThrow(PlatformError);
      expect(fn("pluralize", { value: 2, one: "item", other: "items" })).toBe(
        "items",
      );
    });
  });
});

describe("openUrl", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens http(s) URLs in a new tab with noopener, and refuses other schemes", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openUrlSafely("https://example.com/docs");
    expect(open).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
    openUrlSafely("/relative");
    expect(open).toHaveBeenLastCalledWith(
      `${window.location.origin}/relative`,
      "_blank",
      "noopener,noreferrer",
    );
    // eslint-disable-next-line no-script-url
    expect(() => openUrlSafely("javascript:alert(1)")).toThrow(
      "only http(s) URLs",
    );
    expect(() => openUrlSafely("data:text/html,hi")).toThrow(
      "only http(s) URLs",
    );
    expect(() => openUrlSafely(42)).toThrow("url must be a string");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("takes the scheme in any case on the web, as WHATWG URL does", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openUrlSafely("HTTPS://Example.com/Docs");
    expect(open).toHaveBeenCalledWith(
      "https://example.com/Docs",
      "_blank",
      "noopener,noreferrer",
    );
    // eslint-disable-next-line no-script-url
    expect(() => openUrlSafely("JavaScript:alert(1)")).toThrow(
      "openUrl takes only http(s) URLs, not javascript:",
    );
    expect(() => openUrlSafely("https://")).toThrow('"https://" is not a URL');
    // WHATWG keeps a backslash in the fragment and query; the page opens.
    openUrlSafely("https://example.com/a?q=1\\2#x\\y");
    expect(open).toHaveBeenLastCalledWith(
      "https://example.com/a?q=1\\2#x\\y",
      "_blank",
      "noopener,noreferrer",
    );
    expect(open).toHaveBeenCalledTimes(2);
  });

  describe("on a platform with window but no location or open (React Native)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("says openUrl is unavailable instead of calling a valid URL invalid", () => {
      vi.stubGlobal("window", {});
      expect(() => openUrlSafely("https://example.com/docs")).toThrow(
        new PlatformError("openUrl is not available on this platform"),
      );
      expect(() => openUrlSafely("https://example.com/docs")).not.toThrow(
        ExpressionError,
      );
      expect(() => openUrlSafely(42)).toThrow("url must be a string");
    });

    it("validates absolute http(s) URLs without a base when open exists but location does not", () => {
      const open = vi.fn(() => null);
      vi.stubGlobal("window", { open });
      openUrlSafely("https://example.com/docs");
      expect(open).toHaveBeenCalledWith(
        "https://example.com/docs",
        "_blank",
        "noopener,noreferrer",
      );
      expect(() => openUrlSafely("/relative")).toThrow(
        '"/relative" is not an absolute URL',
      );
      // eslint-disable-next-line no-script-url
      expect(() => openUrlSafely("javascript:alert(1)")).toThrow(
        "only http(s) URLs",
      );
      expect(open).toHaveBeenCalledTimes(1);
    });

    it.each(Object.keys(RN_URL_MODELS) as (keyof typeof RN_URL_MODELS)[])(
      "validates with the URL class of React Native %s in place",
      (version) => {
        const open = vi.fn(() => null);
        vi.stubGlobal("window", { open });
        vi.stubGlobal("URL", RN_URL_MODELS[version]);
        const refusal = (url: string) => {
          try {
            openUrlSafely(url);
          } catch (error) {
            expect(error).toBeInstanceOf(ExpressionError);
            return (error as Error).message;
          }
          return undefined;
        };
        expect(refusal("/relative")).toBe('"/relative" is not an absolute URL');
        expect(refusal("https://")).toBe('"https://" is not a URL');
        expect(refusal("ftp://example.com/")).toBe(
          "openUrl takes only http(s) URLs, not ftp:",
        );
        expect(refusal("HTTPS://example.com/docs")).toBeUndefined();
        expect(open).toHaveBeenCalledWith(
          "https://example.com/docs",
          "_blank",
          "noopener,noreferrer",
        );
        expect(open).toHaveBeenCalledTimes(1);
      },
    );

    // IP literals, checked by parseUrl, against WHATWG URL as the oracle.
    const IP_HOSTS = {
      valid: [
        "192.168.0.1",
        "0.0.0.0",
        "255.255.255.255",
        "1.2.3.4.",
        "0x7f.1",
        "0x7f000001",
        "017.0.0.1",
        "4294967295",
        "[::1]",
        "[::]",
        "[2001:db8::]",
        "[2001:DB8:0:0:8:800:200C:417A]",
        "[1:2:3:4:5:6:7:8]",
        "[::1:2:3:4:5:6:7]",
        "[1:2:3:4:5:6:7::]",
        "[::ffff:192.168.0.1]",
        "[1:2:3:4:5:6:1.2.3.4]",
        "[::1.2.3.4]",
      ],
      invalid: [
        "999.999.999.999",
        "256.0.0.1",
        "1.2.3.256",
        "1.2.3.4.5",
        "4294967296",
        "09.1.1.1",
        "0x7g.1",
        "example.123",
        "1..2.3",
        "[:::]",
        "[1::2::3]",
        "[:1::]",
        "[1:]",
        "[::1:]",
        "[12345::]",
        "[1:2:3:4:5:6:7:8:9]",
        "[1:2:3:4::5:6:7:8]",
        "[1:2:3:4:5:6:7]",
        "[g::1]",
        "[1.2.3.4]",
        "[1.2.3.4::]",
        "[::1.2.3]",
        "[::256.1.1.1]",
        "[::01.2.3.4]",
        "[::1.2.3.4:5]",
        "[1:2:3:4:5:6:7:1.2.3.4]",
        "[fe80::1%25eth0]",
      ],
    };

    it.each([
      ...IP_HOSTS.valid.map((host) => [host, true] as const),
      ...IP_HOSTS.invalid.map((host) => [host, false] as const),
    ])("checks the IP host %s as WHATWG URL does", (host, valid) => {
      const target = `https://${host}/a`;
      let whatwg: string | undefined;
      try {
        whatwg = new URL(target).href;
      } catch {
        whatwg = undefined;
      }
      expect(whatwg !== undefined, "the oracle agrees with the table").toBe(
        valid,
      );
      const open = vi.fn(() => null);
      vi.stubGlobal("window", { open });
      if (!valid) {
        expect(() => openUrlSafely(target)).toThrow(
          new ExpressionError(`"${target}" is not a URL`),
        );
        expect(open).not.toHaveBeenCalled();
        return;
      }
      openUrlSafely(target);
      expect(open).toHaveBeenCalledTimes(1);
      const href = (open.mock.calls[0] as unknown[])[0] as string;
      // An IPv4 host is opened as WHATWG serializes it; an IPv6 literal
      // keeps its spelling (lowercase), which names the same address.
      if (host.startsWith("[")) {
        expect(href).toBe(`https://${host.toLowerCase()}/a`);
      } else {
        expect(href).toBe(whatwg);
      }
    });
  });
});

/**
 * openUrlSafely as it was before the React Native work (c7815d9ac9): on a
 * browser page the result must stay exactly this.
 */
function legacyOpenUrl(url: string, open: (href: string) => void) {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    throw new ExpressionError(`"${url}" is not a URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ExpressionError(
      `openUrl takes only http(s) URLs, not ${parsed.protocol}`,
    );
  }
  open(parsed.href);
}

/** What a call does: the URL opened, or the error thrown. */
function outcome(run: () => void, opened: string[]) {
  const before = opened.length;
  try {
    run();
  } catch (error) {
    return { threw: (error as Error).name, message: (error as Error).message };
  }
  return { opened: opened.slice(before) };
}

/** URLs whose web outcome is pinned to the pre-React-Native code. */
const WEB_PARITY_URLS = [
  "https://example.com/docs",
  "http://example.com",
  "HTTPS://Example.com/Docs",
  "Http://example.com",
  "/relative",
  "relative/path?q=1#h",
  "?only=query",
  "#only-hash",
  "//example.com/protocol-relative",
  "https://example..com/",
  "https://.example.com/",
  "https://example.com./",
  "https://exa_mple.com/",
  "https://EXAMPLE.com:8443/a b",
  "https://user:pass@example.com/",
  "https://[::1]:8080/",
  "https://192.168.0.1/",
  "https://0x7f.1/",
  "https://例え.jp/",
  "https:example.com",
  "http:example.com",
  "https:///path",
  "https://",
  "https://exa mple.com/",
  "https://example.com:99999/",
  "https://exa\\mple.com/",
  "https://example.com/a\\b",
  "https://example.com/a\nb",
  "  https://example.com/trim  ",
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,hi",
  "ftp://example.com/",
  "mailto:a@b.co",
];

describe("openUrl on a browser page keeps the pre-React-Native behaviour", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(WEB_PARITY_URLS)("%j gives the same result as before", (url) => {
    const opened: string[] = [];
    vi.spyOn(window, "open").mockImplementation((href) => {
      opened.push(String(href));
      return null;
    });
    const now = outcome(() => openUrlSafely(url), opened);
    const before = outcome(
      () => legacyOpenUrl(url, (href) => opened.push(href)),
      opened,
    );
    expect(now).toEqual(before);
  });

  it("opens hosts WHATWG URL accepts, such as empty labels", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openUrlSafely("https://example..com/");
    openUrlSafely("https://.example.com/");
    expect(open.mock.calls.map((call) => call[0])).toEqual([
      "https://example..com/",
      "https://.example.com/",
    ]);
  });

  it("resolves against a page that is not http(s), as WHATWG URL does", () => {
    const opened: string[] = [];
    vi.spyOn(window, "open").mockImplementation((href) => {
      opened.push(String(href));
      return null;
    });
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "file:///Users/me/page.html",
    });
    for (const url of ["https://example..com/", "/relative", "x.html"]) {
      expect(outcome(() => openUrlSafely(url), opened)).toEqual(
        outcome(() => legacyOpenUrl(url, (href) => opened.push(href)), opened),
      );
    }
    expect(opened).toEqual(["https://example..com/", "https://example..com/"]);
  });
});

describe("the reason the dispatcher gives for a basic function", () => {
  afterEach(() => vi.unstubAllGlobals());
  const origin = { surfaceId: "s1", componentId: "c1" };
  const dispatcher = () =>
    createGenerativeUIDispatcher({ getDeclared: () => new Map() });

  it("is handler_failed, not invalid_arguments, when Intl is missing", async () => {
    vi.stubGlobal("Intl", undefined);
    const result = await dispatcher().invoke(
      "formatNumber",
      { value: 1 },
      origin,
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "handler_failed",
        message:
          '"formatNumber" failed: formatNumber needs Intl.NumberFormat, which this platform does not have',
      }),
    });
  });

  it("is handler_failed, not invalid_arguments, when openUrl is unavailable", async () => {
    vi.stubGlobal("window", {});
    const result = await dispatcher().invoke(
      "openUrl",
      { url: "https://example.com/" },
      origin,
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "handler_failed",
        message: '"openUrl" failed: openUrl is not available on this platform',
      }),
    });
  });

  it("stays invalid_arguments for bad arguments", async () => {
    const result = await dispatcher().invoke(
      "openUrl",
      { url: "javascript:alert(1)" },
      origin,
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "invalid_arguments" }),
    });
  });
});
