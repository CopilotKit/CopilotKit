import { Config, Flags, Args } from "@oclif/core";
import inquirer from "inquirer";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { promisify } from "util";
import { pipeline } from "stream";
import { createWriteStream } from "fs";
import { extract } from "tar";
import ora, { Ora } from "ora";

import { BaseCommand } from "./base-command.js";
import {
  cloneGitHubSubdirectory,
  isValidGitHubUrl,
} from "../lib/init/scaffold/github.js";

const streamPipeline = promisify(pipeline);

const theme = {
  primary: chalk.magenta,
  secondary: chalk.gray,
  tertiary: chalk.gray,
  error: chalk.red,
  command: chalk.blue,
  success: chalk.green,
  warning: chalk.yellow,
  divider: chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"),
  bottomPadding: "",
};

interface CreateOptions {
  projectName: string;
  agentFramework: AgentFramework;
}

type AgentFramework =
  | "langgraph-py"
  | "langgraph-js"
  | "flows"
  | "mastra"
  | "pydantic-ai"
  | "llamaindex"
  | "agno"
  | "ag2"
  | "adk"
  | "aws-strands-py"
  | "a2a"
  | "microsoft-agent-framework-dotnet"
  | "microsoft-agent-framework-py"
  | "mcp-apps"
  | "agentcore-langgraph"
  | "agentcore-strands";

const TEMPLATE_REPOS: Record<AgentFramework, string> = {
  "langgraph-py":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/langgraph-python",
  "langgraph-js":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/langgraph-js",
  mastra:
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/mastra",
  flows:
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/crewai-flows",
  llamaindex:
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/llamaindex",
  agno: "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/agno",
  "pydantic-ai":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/pydantic-ai",
  ag2: "ag2ai/ag2-copilotkit-starter",
  adk: "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/adk",
  "aws-strands-py":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/strands-python",
  a2a: "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/a2a-middleware",
  "microsoft-agent-framework-dotnet":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/ms-agent-framework-dotnet",
  "microsoft-agent-framework-py":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/ms-agent-framework-python",
  "mcp-apps":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/mcp-apps",
  "agentcore-langgraph":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/agentcore",
  "agentcore-strands":
    "https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/agentcore",
};

const FRAMEWORK_DOCUMENTATION: Record<AgentFramework, string> = {
  "langgraph-py":
    "https://langchain-ai.github.io/langgraph/concepts/why-langgraph",
  "langgraph-js": "https://langchain-ai.github.io/langgraphjs",
  flows: "https://docs.crewai.com/guides/flows/first-flow",
  mastra: "https://mastra.ai/en/docs",
  "pydantic-ai": "https://ai.pydantic.dev/ag-ui/",
  llamaindex: "https://docs.llamaindex.ai/en/stable",
  agno: "https://docs.agno.com/",
  ag2: "https://docs.ag2.ai/latest/docs/user-guide/basic-concepts/overview",
  adk: "https://google.github.io/adk-docs/",
  "aws-strands-py": "https://strandsagents.com/latest/documentation/docs/",
  a2a: "https://a2a-protocol.org/latest/",
  "microsoft-agent-framework-dotnet":
    "https://learn.microsoft.com/en-us/agent-framework/",
  "microsoft-agent-framework-py":
    "https://learn.microsoft.com/en-us/agent-framework/",
  "mcp-apps": "https://modelcontextprotocol.github.io/ext-apps",
  "agentcore-langgraph":
    "https://docs.copilotkit.ai/integrations/agentcore/quickstart",
  "agentcore-strands":
    "https://docs.copilotkit.ai/integrations/agentcore/quickstart",
};

const FRAMEWORK_EMOJI: Record<AgentFramework, string> = {
  "langgraph-js": "🦜",
  "langgraph-py": "🦜",
  flows: "👥",
  mastra: "🌑",
  "pydantic-ai": "🔼",
  llamaindex: "🦙",
  ag2: "🤖",
  agno: "🅰️",
  adk: "🤖",
  a2a: "🤖",
  "aws-strands-py": "🧬",
  "microsoft-agent-framework-dotnet": "🟦",
  "microsoft-agent-framework-py": "🟦",
  "mcp-apps": "♍",
  "agentcore-langgraph": "☁️",
  "agentcore-strands": "☁️",
};

const KITE = `
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠙⣿⡛⠻⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠋⠀⠀⠈⢿⡄⠀⠀⠀⠈⠉⠙⣻⣿⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠈⢿⡄⠀⢀⣠⣴⠾⠋⢸⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠁⢀⣀⣀⣀⣀⣤⣤⡾⢿⡟⠛⠉⠀⠀⠀⠀⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡛⠛⠛⠛⠉⠉⠉⠁⠀⢠⡿⣿⡀⠀⠀⠀⠀⠀⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣆⠀⠀⠀⠀⠀⠀⣰⡟⠀⠸⣧⠀⠀⠀⠀⢠⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⢀⣼⠏⠀⠀⠀⣿⡀⠀⠀⠀⢸⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠂⣠⡿⠁⠀⠀⠀⠀⢸⡇⠀⠀⠀⣿⣿⣿
⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⣡⣾⣿⣄⠀⠀⠀⠀⠀⢸⡇⠀⠀⢰⣿⣿⣿
⣿⣿⣿⣿⣿⣿⣿⡟⠛⡿⠋⣡⣾⣿⣿⣿⣿⣦⡀⠀⠀⠀⢸⡇⠀⠀⣿⣿⣿⣿
⣿⣿⣿⣿⡿⠿⣿⠷⠂⡀⠘⣿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⢸⡇⠀⣼⣿⣿⣿⣿
⣿⣿⠻⢿⡷⠀⠁⠴⣿⣷⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⣾⠇⣴⣿⣿⣿⣿⣿
⡿⠛⠀⠀⢴⣾⣷⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣤⣿⣾⣿⣿⣿⣿⣿⣿
⣷⣾⣿⣤⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
`;

export default class Create extends BaseCommand {
  static description = "Create a new CopilotKit project";

  static examples = [
    "$ copilotkit create my-app",
    "$ copilotkit create my-app --framework langgraph-js",
    "$ copilotkit create -n my-app -f langgraph-js",
  ];

  static flags = {
    ...BaseCommand.flags,
    framework: Flags.string({
      char: "f",
      description: "Agent framework to use",
      options: Object.keys(TEMPLATE_REPOS),
      required: false,
    }),
    name: Flags.string({
      char: "n",
      description: "Name of the project",
      required: false,
    }),
    "no-banner": Flags.boolean({
      char: "q",
      description: "Removes the banner",
      default: false,
      required: false,
    }),
    project: Flags.string({
      description: "project ID (deprecated, kept for backwards compatibility)",
    }),
  };

  static args = {
    projectName: Args.string({
      description: "Name of the project",
      required: false,
    }),
  };

  constructor(argv: string[], config: Config) {
    super(argv, config);
  }

  async run() {
    const { args, flags } = await this.parse(Create);

    if (!flags["no-banner"]) {
      this.log(theme.primary(KITE));
      this.log(theme.primary("~ Welcome to CopilotKit! ~\n"));
      this.log(theme.divider);

      if (!flags.name && !args.projectName && !flags.framework) {
        this.log(
          "\n" + theme.secondary("Just a few questions to get started!\n"),
        );
      }
    }

    const projectNameInput =
      flags.name || args.projectName || (await this.promptProjectName());
    const projectName = projectNameInput.trim();
    const usingCurrentDir = projectName === "." || projectName === "./";
    const agentFramework =
      flags.framework || (await this.promptAgentFramework());

    const projectDir = usingCurrentDir
      ? process.cwd()
      : path.resolve(process.cwd(), projectName);

    if (usingCurrentDir) {
      const allowedEntries = new Set([".git", ".gitignore", ".DS_Store"]);
      const existingEntries = await fs.readdir(projectDir);
      const blockingEntries = existingEntries.filter(
        (entry) => !allowedEntries.has(entry),
      );

      if (blockingEntries.length > 0) {
        this.log(theme.error("\nCurrent directory is not empty."));
        this.log(
          theme.secondary(
            "\nPlease run create in an empty directory or specify a new project name.",
          ),
        );
        this.exit(1);
      }
    } else if (await fs.pathExists(projectDir)) {
      this.log(theme.error(`\nDirectory "${projectName}" already exists.`));
      this.log(theme.secondary("\nYou can:"));
      this.log(theme.secondary("  1. Choose a different project name"));
      this.log(
        theme.secondary(
          "  2. Remove the existing directory manually if you want to use this name\n",
        ),
      );
      this.exit(1);
    }

    const options: CreateOptions = {
      projectName,
      agentFramework: agentFramework as AgentFramework,
    };

    const spinner = ora({
      text: theme.secondary.bold("Creating your project..."),
      color: "cyan",
      spinner: "dots",
    }).start();

    try {
      await fs.ensureDir(projectDir);

      spinner.text = theme.secondary.bold("Downloading template...");
      await this.downloadTemplate(projectDir, options.agentFramework, spinner);

      if (
        options.agentFramework === "agentcore-langgraph" ||
        options.agentFramework === "agentcore-strands"
      ) {
        spinner.text = theme.secondary.bold("Configuring AgentCore...");
        await this.configureAgentCore(projectDir, options.agentFramework);
      }

      const displayName = usingCurrentDir
        ? "current directory"
        : `"${projectName}"`;
      spinner.succeed(
        theme.secondary.bold(`Project ${displayName} created successfully!`),
      );
    } catch (error: any) {
      spinner.fail(theme.error(`Failed to create project: ${error.message}`));
      this.exit(1);
    }

    this.log("\n" + theme.divider);
    this.log(
      "\n" +
        theme.secondary.bold(
          `🪁🤝${FRAMEWORK_EMOJI[options.agentFramework]} All set! \n\nYour project is ready to explore CopilotKit locally.`,
        ),
    );
    this.log("\n" + theme.secondary("Next steps:"));
    if (usingCurrentDir) {
      this.log(
        theme.secondary(
          "  • You are already inside your new project directory",
        ),
      );
    } else {
      this.log(theme.secondary(`  • ${theme.command(`cd ${projectName}`)}`));
    }
    this.log(
      theme.secondary("  • Follow the setup instructions in the README.md"),
    );
    this.log("\n" + theme.secondary("Documentation:"));
    this.log(
      theme.secondary("  • ") + theme.command("https://docs.copilotkit.ai"),
    );
    this.log(
      theme.secondary("  • ") +
        theme.command(FRAMEWORK_DOCUMENTATION[options.agentFramework]),
    );
    this.log(theme.bottomPadding);
  }

  private async promptProjectName(): Promise<string> {
    const { projectName } = await inquirer.prompt([
      {
        type: "input",
        name: "projectName",
        message: theme.secondary("What is your project named?"),
        validate: (input: string) => {
          if (!input) return theme.error("Project name is required");
          if (!/^[a-z0-9-]+$/.test(input)) {
            return theme.error(
              "Project name can only contain lowercase letters, numbers, and hyphens",
            );
          }
          if (input.length > 30) {
            return theme.error("Project name must be less than 30 characters");
          }
          return true;
        },
      },
    ]);
    return projectName;
  }

  private async promptAgentFramework(): Promise<string> {
    const { framework } = await inquirer.prompt([
      {
        type: "list",
        name: "framework",
        message: theme.secondary(
          "Which agent framework would you like to use?",
        ),
        choices: [
          {
            name: `${FRAMEWORK_EMOJI["langgraph-py"]} LangGraph (Python)`,
            value: "langgraph-py",
          },
          {
            name: `${FRAMEWORK_EMOJI["langgraph-js"]} LangGraph (JavaScript)`,
            value: "langgraph-js",
          },
          { name: `${FRAMEWORK_EMOJI.mastra} Mastra`, value: "mastra" },
          {
            name: `${FRAMEWORK_EMOJI["pydantic-ai"]} Pydantic AI`,
            value: "pydantic-ai",
          },
          {
            name: `${FRAMEWORK_EMOJI["aws-strands-py"]} AWS Strands (Python)`,
            value: "aws-strands-py",
          },
          { name: `${FRAMEWORK_EMOJI.adk} ADK`, value: "adk" },
          {
            name: `${FRAMEWORK_EMOJI["microsoft-agent-framework-dotnet"]} Microsoft Agent Framework (.NET)`,
            value: "microsoft-agent-framework-dotnet",
          },
          {
            name: `${FRAMEWORK_EMOJI["microsoft-agent-framework-py"]} Microsoft Agent Framework (Python)`,
            value: "microsoft-agent-framework-py",
          },
          {
            name: `${FRAMEWORK_EMOJI["mcp-apps"]} MCP Apps`,
            value: "mcp-apps",
          },
          { name: `${FRAMEWORK_EMOJI.flows} CrewAI Flows`, value: "flows" },
          {
            name: `${FRAMEWORK_EMOJI.llamaindex} LlamaIndex`,
            value: "llamaindex",
          },
          { name: `${FRAMEWORK_EMOJI.agno}  Agno`, value: "agno" },
          { name: `${FRAMEWORK_EMOJI.ag2} AG2`, value: "ag2" },
          { name: `${FRAMEWORK_EMOJI.a2a} A2A`, value: "a2a" },
          {
            name: `${FRAMEWORK_EMOJI["agentcore-langgraph"]} AgentCore + LangGraph`,
            value: "agentcore-langgraph",
          },
          {
            name: `${FRAMEWORK_EMOJI["agentcore-strands"]} AgentCore + Strands`,
            value: "agentcore-strands",
          },
        ],
      },
    ]);
    return framework;
  }

  private async configureAgentCore(
    projectDir: string,
    framework: "agentcore-langgraph" | "agentcore-strands",
  ): Promise<void> {
    const pattern =
      framework === "agentcore-langgraph"
        ? "langgraph-single-agent"
        : "strands-single-agent";
    const suffix = framework === "agentcore-langgraph" ? "-lg" : "-st";

    const examplePath = path.join(projectDir, "config.yaml.example");
    const configPath = path.join(projectDir, "config.yaml");

    if (!(await fs.pathExists(examplePath))) {
      throw new Error(
        `config.yaml.example not found in the AgentCore template at "${projectDir}". ` +
          `The downloaded template may be incomplete. Please try again.`,
      );
    }

    let content = await fs.readFile(examplePath, "utf-8");

    const patternRegex = /^(\s*pattern:\s*)\S+(.*)$/m;
    const stackRegex = /^(\s*stack_name_base:\s*)\S+(.*)$/m;

    if (!patternRegex.test(content) || !stackRegex.test(content)) {
      throw new Error(
        `Unexpected config.yaml.example format in the AgentCore template. ` +
          `Expected "pattern:" and "stack_name_base:" keys. Please try again or ` +
          `report this issue at https://github.com/CopilotKit/CopilotKit/issues`,
      );
    }

    content = content.replace(patternRegex, `$1${pattern}$2`);
    content = content.replace(
      stackRegex,
      `$1my-copilotkit-agentcore${suffix}$2`,
    );
    await fs.writeFile(configPath, content, "utf-8");

    // Remove the other agent, the other deploy script, and terraform
    const isLanggraph = framework === "agentcore-langgraph";
    const removeAgent = isLanggraph
      ? "strands-single-agent"
      : "langgraph-single-agent";
    const removeScript = isLanggraph
      ? "deploy-strands.sh"
      : "deploy-langgraph.sh";
    const keepScript = isLanggraph
      ? "deploy-langgraph.sh"
      : "deploy-strands.sh";

    await Promise.all([
      fs.remove(path.join(projectDir, "agents", removeAgent)),
      fs.remove(path.join(projectDir, removeScript)),
      fs.remove(path.join(projectDir, "infra-terraform")),
    ]);

    // Rename the remaining deploy script to deploy.sh
    const keepScriptPath = path.join(projectDir, keepScript);
    if (await fs.pathExists(keepScriptPath)) {
      await fs.move(keepScriptPath, path.join(projectDir, "deploy.sh"));
    }
  }

  private async downloadTemplate(
    projectDir: string,
    framework: AgentFramework,
    spinner: Ora,
  ): Promise<void> {
    const templateRef = TEMPLATE_REPOS[framework];

    // Monorepo subdirectory URLs use sparse checkout; standalone repos use tarball download
    if (isValidGitHubUrl(templateRef)) {
      const success = await cloneGitHubSubdirectory(
        templateRef,
        projectDir,
        spinner,
      );
      if (!success) {
        throw new Error(`Failed to clone template from ${templateRef}`);
      }
      return;
    }

    // Fallback: standalone repo tarball (e.g. ag2ai/ag2-copilotkit-starter)
    const url = `https://github.com/${templateRef}/archive/refs/heads/main.tar.gz`;

    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Failed to download template: ${response.statusText}`);

      const tempFile = path.join(projectDir, "template.tar.gz");
      const fileStream = createWriteStream(tempFile);

      if (!response.body) throw new Error("Failed to get response body");
      await streamPipeline(response.body as any, fileStream);

      await extract({
        file: tempFile,
        cwd: projectDir,
        strip: 1,
      });

      await fs.remove(tempFile);
    } catch (error: any) {
      throw new Error(`Failed to download template: ${error.message}`);
    }
  }
}
