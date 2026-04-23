import { describe, expect, it } from "vitest";
import { parseSync } from "oxc-parser";
import { ERROR_BOUNDARY_SOURCE } from "../error-boundary-source";

describe("ERROR_BOUNDARY_SOURCE", () => {
  it("exports an ErrorBoundary class and a named MountCard component", () => {
    expect(ERROR_BOUNDARY_SOURCE).toContain("export class ErrorBoundary");
    expect(ERROR_BOUNDARY_SOURCE).toContain("export function MountCard");
    expect(ERROR_BOUNDARY_SOURCE).toContain("componentDidCatch");
    expect(ERROR_BOUNDARY_SOURCE).toContain("getDerivedStateFromError");
  });

  it("the source parses as valid TSX", () => {
    const res = parseSync("error-boundary.tsx", ERROR_BOUNDARY_SOURCE, {
      lang: "tsx",
      sourceType: "module",
    });
    expect(res.errors).toEqual([]);
  });
});
