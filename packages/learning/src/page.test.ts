import { describe, expect, it } from "vitest";
import { describePage } from "./page";

describe("bounded page pathname", () => {
  it.each([
    "/",
    "/reviews/inbox",
    "/v2/planning-board",
    "/caf%C3%A9/menu",
    "/product-trajectories-early-access",
    "/continuous-trajectory-learning",
  ])(
    "retains route structure for %s without reading other location fields",
    (pathname) => {
      const location = {
        protocol: "https:",
        pathname,
        get href() {
          throw new Error("must not read href");
        },
        get search() {
          throw new Error("must not read query");
        },
        get hash() {
          throw new Error("must not read hash");
        },
        get origin() {
          throw new Error("must not read origin");
        },
      };
      expect(describePage(location)).toEqual({ pathname });
    },
  );

  it.each([
    "42",
    "１２３",
    "١٢٣",
    "1234-5678",
    "customer-123456",
    "550e8400-e29b-41d4-a716-446655440000",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "9b031adefe239140ab921ec4",
    "AbC12defGH34ijkLM56nopQR78",
    "xJ4n7bQa-H2m9cLvRsW5u8Yz",
    "a".repeat(80),
    "alice@example.test",
    "alice%40example.test",
    "alice%2540example.test",
    "token=short",
    "api_key=short",
    "password-short",
    "Bearer%20abc",
    "x%00y",
    "x%250Ay",
    "x\u200by",
    "x%2Fy",
    "x%255Cy",
    "..",
    "%252e%252e",
    "x%253Fy",
    "%252540",
    "%broken",
  ])("redacts the entire suspicious segment %s", (segment) => {
    expect(
      describePage({
        protocol: "https:",
        pathname: `/orders/${segment}/review`,
      }),
    ).toEqual({
      pathname: "/orders/:redacted/review",
      redacted: true,
    });
  });

  it("redacts credential keys and their following values, preserving slashes", () => {
    expect(
      describePage({
        protocol: "https:",
        pathname: "/auth/token/short-value//finish/",
      }),
    ).toEqual({
      pathname: "/auth/:redacted/:redacted//finish/",
      redacted: true,
    });
  });

  it.each(["reset-password", "reset_password"])(
    "redacts the value after credential-key alias %s",
    (key) => {
      expect(
        describePage({
          protocol: "https:",
          pathname: `/auth/${key}/short-value/finish`,
        }),
      ).toEqual({
        pathname: "/auth/:redacted/:redacted/finish",
        redacted: true,
      });
    },
  );

  it("omits the whole oversized path, including multibyte paths", () => {
    for (const pathname of ["/" + "x".repeat(1024), "/" + "é/".repeat(350)]) {
      expect(describePage({ protocol: "https:", pathname })).toEqual({
        omitted: "size-limit",
      });
    }
    const pathname = "/" + "ab/".repeat(341);
    expect(new TextEncoder().encode(pathname).byteLength).toBe(1024);
    expect(describePage({ protocol: "http:", pathname })).toEqual({ pathname });
  });

  it("omits when redaction expansion exceeds the pathname byte budget", () => {
    expect(
      describePage({ protocol: "https:", pathname: "/1".repeat(300) }),
    ).toEqual({ omitted: "size-limit" });
  });

  it.each(["file:", "data:", "about:", "blob:"])(
    "omits unsupported %s locations",
    (protocol) => {
      expect(describePage({ protocol, pathname: "/private" })).toEqual({
        omitted: "unsupported-location",
      });
    },
  );

  it("contains an unreadable location without throwing or reading its other fields", () => {
    expect(
      describePage({
        protocol: "https:",
        get pathname(): string {
          throw new Error("unavailable");
        },
      }),
    ).toEqual({ omitted: "unsupported-location" });
  });
});
