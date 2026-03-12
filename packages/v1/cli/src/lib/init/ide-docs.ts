import path from "path";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import { Ora } from "ora";
import chalk from "chalk";

export type SupportedIDE = "cursor" | "windsurf";

export interface IDEDocsConfig {
  name: SupportedIDE;
  displayName: string;
  rulesDir: string;
  ruleFileName: string;
  createRuleContent: () => string;
}

// Template constant for CopilotKit documentation rule
const COPILOTKIT_DOC_RULE_TEMPLATE = `---
description: CopilotKit Documentation - Complete CopilotKit framework documentation for AI assistance
alwaysApply: false
---

# CopilotKit Documentation

For ANY question about CopilotKit, use the comprehensive documentation available at:
@https://docs.copilotkit.ai/llms-full.txt

This contains the complete CopilotKit documentation including:
- API references and hooks (useCopilotChat, useCopilotAction, etc.)
- Component library documentation (CopilotKit, CopilotChat, etc.)
- Integration guides and examples
- Best practices and patterns
- Troubleshooting and FAQs

Always reference this documentation when working with CopilotKit to provide accurate, up-to-date information.
`;

// IDE-specific configurations
export const IDE_DOCS_CONFIGS: Record<SupportedIDE, IDEDocsConfig> = {
  cursor: {
    name: "cursor",
    displayName: "Cursor",
    rulesDir: ".cursor/rules",
    ruleFileName: "00-copilotkit-docs.mdc",
    createRuleContent: () => COPILOTKIT_DOC_RULE_TEMPLATE,
  },
  windsurf: {
    name: "windsurf",
    displayName: "Windsurf",
    rulesDir: ".windsurf/rules",
    ruleFileName: "00-copilotkit-docs.md",
    createRuleContent: () => COPILOTKIT_DOC_RULE_TEMPLATE,
  },
};

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (!existsSync(dirPath)) {
      throw error;
    }
  }
}

/**
 * Check if path exists
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a specific IDE is installed by looking for its configuration directory
 */
async function checkIDEInstallation(ide: SupportedIDE): Promise<boolean> {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    let configPath: string;

    switch (ide) {
      case "cursor":
        configPath = path.join(homeDir, ".cursor");
        break;
      case "windsurf":
        configPath = path.join(homeDir, ".codeium", "windsurf");
        break;
      default:
        return false;
    }

    return existsSync(configPath);
  } catch {
    return false;
  }
}

/**
 * Detect which supported IDEs are installed on the system
 */
export async function detectInstalledIDEs(): Promise<SupportedIDE[]> {
  const allIDEs: SupportedIDE[] = ["cursor", "windsurf"];
  const installedIDEs: SupportedIDE[] = [];

  for (const ide of allIDEs) {
    if (await checkIDEInstallation(ide)) {
      installedIDEs.push(ide);
    }
  }

  return installedIDEs;
}

/**
 * Setup IDE documentation rules for the selected IDE
 */
export async function setupIDEDocs(
  ide: SupportedIDE,
  projectDir: string,
): Promise<void> {
  const config = IDE_DOCS_CONFIGS[ide];
  const rulesDir = path.join(projectDir, config.rulesDir);
  const ruleFilePath = path.join(rulesDir, config.ruleFileName);

  // Ensure rules directory exists
  await ensureDir(rulesDir);

  // Check if rule file already exists
  if (await pathExists(ruleFilePath)) {
    console.log(
      chalk.yellow(
        `⚠️  CopilotKit documentation rule already exists for ${config.displayName}`,
      ),
    );
    return;
  }

  // Create the rule file with content
  const ruleContent = config.createRuleContent();
  await fs.writeFile(ruleFilePath, ruleContent, "utf8");
}

/**
 * Get setup instructions for the IDE
 */
function getIDEInstructions(ide: SupportedIDE): string[] {
  const config = IDE_DOCS_CONFIGS[ide];

  const instructions = [
    chalk.cyan(
      `📚 CopilotKit documentation configured for ${config.displayName}!`,
    ),
    "",
    chalk.bold("What this does:"),
    "  • Adds CopilotKit documentation context to your IDE AI assistant",
    "  • Provides accurate, up-to-date information about CopilotKit APIs",
    "  • Improves code suggestions and help responses",
    "",
    chalk.bold("Location:"),
    `  • Rule file: ${chalk.gray(path.join(config.rulesDir, config.ruleFileName))}`,
    "",
    chalk.bold("Usage:"),
    "  • Your IDE AI assistant now has access to CopilotKit documentation",
    "  • Ask questions about CopilotKit APIs, components, and patterns",
    "  • The AI will reference official documentation for accurate answers",
  ];

  if (ide === "cursor") {
    instructions.push(
      "",
      chalk.bold("Next steps for Cursor:"),
      "  • Restart Cursor if currently open",
      "  • The rule will be automatically available in your AI context",
      "  • Start a new chat to use the documentation context",
    );
  } else if (ide === "windsurf") {
    instructions.push(
      "",
      chalk.bold("Next steps for Windsurf:"),
      "  • Restart Windsurf if currently open",
      "  • The rule will be automatically available in your AI context",
      "  • Start a new chat to use the documentation context",
    );
  }

  return instructions;
}

/**
 * Main function to handle IDE documentation setup with user interaction
 */
export async function handleIDEDocsSetup(
  selectedIDE: SupportedIDE,
  projectDir: string,
  spinner: Ora,
): Promise<void> {
  try {
    spinner.text = chalk.cyan(
      `Setting up CopilotKit documentation for ${IDE_DOCS_CONFIGS[selectedIDE].displayName}...`,
    );

    // Setup IDE documentation rules
    await setupIDEDocs(selectedIDE, projectDir);

    spinner.succeed(
      chalk.green(
        `CopilotKit documentation configured for ${IDE_DOCS_CONFIGS[selectedIDE].displayName}`,
      ),
    );

    // Show instructions
    const instructions = getIDEInstructions(selectedIDE);
    console.log("\n" + instructions.join("\n"));
  } catch (error) {
    spinner.fail(
      chalk.red(
        `Failed to setup IDE documentation: ${error instanceof Error ? error.message : "Unknown error"}`,
      ),
    );
    throw error;
  }
}
