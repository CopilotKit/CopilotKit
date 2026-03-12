import { describe, test, expect } from "@jest/globals";
import fs from "fs";
import path from "path";

const createCommandPath = path.join(__dirname, "../../src/commands/create.ts");
const createCommandSource = fs.readFileSync(createCommandPath, "utf8");

describe("Create Command - Cloudless flow", () => {
  test("does not depend on AuthService or analytics", () => {
    expect(createCommandSource).not.toContain("AuthService");
    expect(createCommandSource).not.toContain("AnalyticsService");
    expect(createCommandSource).not.toContain("createTRPCClient");
    expect(createCommandSource).not.toContain("requireLogin");
  });

  test("does not mention automatic cloud sign-up messaging", () => {
    expect(createCommandSource).not.toContain("Setting up your cloud account");
    expect(createCommandSource).not.toContain("Retrieving your API key");
    expect(createCommandSource).toContain(
      "Your project is ready to explore CopilotKit locally",
    );
  });

  test("supports creating projects in the current directory", () => {
    expect(createCommandSource).toMatch(/projectName === ["']\.["']/);
    expect(createCommandSource).toContain(
      "You are already inside your new project directory",
    );
  });
});
