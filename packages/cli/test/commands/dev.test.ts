import { runCommand } from "@oclif/test";
import { expect } from "chai";

describe("dev", () => {
  it("runs dev cmd", async () => {
    const { stdout } = await runCommand("dev");
    expect(stdout).to.contain("hello world");
  });

  it("runs dev --name oclif", async () => {
    const { stdout } = await runCommand("dev --name oclif");
    expect(stdout).to.contain("hello oclif");
  });
});
