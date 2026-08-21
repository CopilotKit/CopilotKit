import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "useInfraApproval.tsx"), "utf8");
const cardSource = readFileSync(
  join(__dirname, "../components/ApprovalCard.tsx"),
  "utf8",
);

describe("useInfraApproval contract", () => {
  it("returns exact approved/rejected strings to the agent", () => {
    expect(source).toContain('respond("approved")');
    expect(source).toContain('respond("rejected")');
  });

  it("renders pending, executing, and complete states", () => {
    expect(source).toContain("Preparing approval request");
    expect(source).toContain('typedStatus === "executing"');
    expect(source).toContain('typedStatus === "complete"');
  });

  it("makes the simulation-only boundary visible to the operator", () => {
    expect(cardSource).toContain("Simulation only");
    expect(cardSource).toContain("no AWS resources will be created");
  });
});
