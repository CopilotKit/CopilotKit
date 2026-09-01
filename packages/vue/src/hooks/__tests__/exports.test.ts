import { describe, expect, it } from "vitest";
import * as VuePackage from "../../../src";

describe("v1 package exports", () => {
  it("exports the v1 hooks from the package root", () => {
    expect(VuePackage.useCopilotAction).toBeTypeOf("function");
    expect(VuePackage.useFrontendTool).toBeTypeOf("function");
    expect(VuePackage.useCopilotReadable).toBeTypeOf("function");
  });
});
