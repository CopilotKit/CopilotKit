import { describe, expect, it } from "vitest";

import { resolveAngularAssetUrls } from "./angular-static-boundaries";

describe("Angular static asset boundaries", () => {
  it("resolves emitted relative assets through the Angular document base", () => {
    expect(
      resolveAngularAssetUrls(
        "http://127.0.0.1:10000",
        "http://127.0.0.1:10000/angular/",
        ["main.js", "styles.css"],
      ),
    ).toEqual([
      "http://127.0.0.1:10000/angular/main.js",
      "http://127.0.0.1:10000/angular/styles.css",
    ]);
  });

  it.each([
    ["an off-origin document base", "https://attacker.example/angular/", []],
    ["a root-level asset", "http://127.0.0.1:10000/angular/", ["/main.js"]],
    [
      "an off-origin asset",
      "http://127.0.0.1:10000/angular/",
      ["https://attacker.example/main.js"],
    ],
  ])("rejects %s", (_label, documentBase, paths) => {
    expect(() =>
      resolveAngularAssetUrls("http://127.0.0.1:10000", documentBase, paths),
    ).toThrow("Angular document contains an unsafe asset URL");
  });
});
