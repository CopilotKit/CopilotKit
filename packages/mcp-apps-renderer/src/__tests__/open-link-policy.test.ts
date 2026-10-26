import { describe, expect, it } from "vitest";
import { denyDangerousSchemes } from "../session";

// A single backslash, written without an escape so the intent is unambiguous.
const BACKSLASH = String.fromCharCode(92);

describe("denyDangerousSchemes", () => {
  it("refuses a slash-prefixed link that resolves off-origin", () => {
    // "/" + "\" + "evil.com" parses as a protocol-relative authority:
    // new URL("/\\evil.com", "http://localhost:3000/") === "http://evil.com/"
    expect(denyDangerousSchemes(`/${BACKSLASH}evil.com`)).toBeUndefined();
  });

  it("refuses a dot-slash-prefixed link that resolves off-origin", () => {
    expect(denyDangerousSchemes(`.${BACKSLASH}evil.com`)).toBeUndefined();
    expect(denyDangerousSchemes(`..${BACKSLASH}evil.com`)).toBeUndefined();
  });

  it("still resolves genuine host-relative paths", () => {
    expect(denyDangerousSchemes("/docs")).toBe("http://localhost:3000/docs");
    expect(denyDangerousSchemes("./x")).toBe("http://localhost:3000/x");
    expect(denyDangerousSchemes("../x")).toBe("http://localhost:3000/x");
  });

  it("still refuses script schemes and embedded credentials", () => {
    expect(denyDangerousSchemes("javascript:alert(1)")).toBeUndefined();
    expect(denyDangerousSchemes("data:text/html,<b>x</b>")).toBeUndefined();
    expect(denyDangerousSchemes("https://user:pw@host")).toBeUndefined();
  });

  it("hands an absolute URL back exactly as written", () => {
    expect(denyDangerousSchemes("https://example.com/x")).toBe(
      "https://example.com/x",
    );
    expect(denyDangerousSchemes("myapp:deep/link")).toBe("myapp:deep/link");
  });

  it("refuses anything that is not one of the three relative forms", () => {
    expect(denyDangerousSchemes("not a url")).toBeUndefined();
    expect(denyDangerousSchemes("docs")).toBeUndefined();
  });
});
