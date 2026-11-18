import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("joins strings, arrays, and truthy object keys, skipping falsy values", () => {
    expect(
      cn("cpk-a", false, null, undefined, "", 0, ["cpk-b", ["cpk-c"]], {
        "cpk-d": true,
        "cpk-e": false,
      }),
    ).toBe("cpk-a cpk-b cpk-c cpk-d");
  });

  it("keeps both classes when they conflict, so the app's class can win in CSS", () => {
    expect(cn("cpk-pill", "my-pill")).toBe("cpk-pill my-pill");
  });
});
