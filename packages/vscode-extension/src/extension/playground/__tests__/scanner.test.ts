import { describe, expect, it } from "vitest";
import { scanPlayground } from "../scanner";

describe("scanPlayground — empty stub", () => {
  it("returns a well-shaped empty result for an unknown directory", () => {
    const result = scanPlayground("/definitely/not/a/real/path");
    expect(result).toEqual({
      providers: [],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    });
  });
});
