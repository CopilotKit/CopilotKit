import { describe, test, expect } from "@jest/globals";
import fs from "fs";
import path from "path";

// Fixture that mirrors the canonical config.yaml.example in the agentcore template.
// If the template format changes and this test breaks, update the fixture AND verify
// the regexes in configureAgentCore() still match the new format before deploying.
const CONFIG_YAML_EXAMPLE_FIXTURE = `\
# ── User-editable settings ──────────────────────────────────────────────────
stack_name_base: my-copilotkit-agentcore   # max 35 chars; used as prefix for all AWS resources
admin_user_email:        # e.g. you@example.com

backend:
  # Set automatically by deploy scripts — do not edit.
  pattern: langgraph-single-agent          # overwritten by deploy-langgraph.sh / deploy-strands.sh
  deployment_type: docker                  # docker (default) or zip
  network_mode: PUBLIC                     # PUBLIC (default) or VPC
`;

// These are the exact regexes used by configureAgentCore() in create.ts.
// Keeping them here makes regressions obvious: a format change will break both.
const PATTERN_REGEX = /^(\s*pattern:\s*)\S+(.*)$/m;
const STACK_REGEX = /^(\s*stack_name_base:\s*)\S+(.*)$/m;

describe("configureAgentCore - config.yaml patching", () => {
  test("regexes match the config.yaml.example fixture", () => {
    expect(PATTERN_REGEX.test(CONFIG_YAML_EXAMPLE_FIXTURE)).toBe(true);
    expect(STACK_REGEX.test(CONFIG_YAML_EXAMPLE_FIXTURE)).toBe(true);
  });

  test("patches pattern and stack_name_base correctly for langgraph", () => {
    let patched = CONFIG_YAML_EXAMPLE_FIXTURE;
    patched = patched.replace(PATTERN_REGEX, "$1langgraph-single-agent$2");
    patched = patched.replace(STACK_REGEX, "$1my-copilotkit-agentcore-lg$2");

    expect(patched).toMatch(/^\s*pattern:\s*langgraph-single-agent/m);
    expect(patched).toMatch(/^stack_name_base:\s*my-copilotkit-agentcore-lg/m);
    // Trailing comment preserved
    expect(patched).toMatch(/my-copilotkit-agentcore-lg\s*#/);
  });

  test("patches pattern and stack_name_base correctly for strands", () => {
    let patched = CONFIG_YAML_EXAMPLE_FIXTURE;
    patched = patched.replace(PATTERN_REGEX, "$1strands-single-agent$2");
    patched = patched.replace(STACK_REGEX, "$1my-copilotkit-agentcore-st$2");

    expect(patched).toMatch(/^\s*pattern:\s*strands-single-agent/m);
    expect(patched).toMatch(/^stack_name_base:\s*my-copilotkit-agentcore-st/m);
  });

  test("does not corrupt other fields", () => {
    let patched = CONFIG_YAML_EXAMPLE_FIXTURE;
    patched = patched.replace(PATTERN_REGEX, "$1langgraph-single-agent$2");
    patched = patched.replace(STACK_REGEX, "$1my-copilotkit-agentcore-lg$2");

    expect(patched).toContain("admin_user_email:");
    expect(patched).toContain("deployment_type: docker");
    expect(patched).toContain("network_mode: PUBLIC");
  });
});

const createCommandPath = path.join(__dirname, "../../src/commands/create.ts");
const createCommandSource = fs.readFileSync(createCommandPath, "utf8");

describe("Create Command - Cloudless flow", () => {
  test("does not depend on AuthService or cloud login", () => {
    expect(createCommandSource).not.toContain("AuthService");
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
