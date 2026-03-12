import ora from "ora";
import chalk from "chalk";
import { cloneGitHubSubdirectory } from "./github.js";
import { Config } from "../types/index.js";
import path from "path";
import fs from "fs";

export async function scaffoldAgent(userAnswers: Config) {
  if (
    userAnswers.mode === "CrewAI" ||
    (userAnswers.mode === "LangGraph" && !userAnswers.langGraphAgent) ||
    userAnswers.mode === "Standard" ||
    userAnswers.mode === "MCP"
  ) {
    return;
  }

  const spinner = ora({
    text: chalk.cyan("Setting up AI agent..."),
    color: "cyan",
  }).start();

  let template = "";
  switch (userAnswers.mode) {
    case "LangGraph":
      if (userAnswers.langGraphAgent === "Python Starter") {
        template = AgentTemplates.LangGraph.Starter.Python;
      } else {
        template = AgentTemplates.LangGraph.Starter.TypeScript;
      }
      break;
  }

  if (!template) {
    spinner.fail(chalk.red("Failed to determine agent template"));
    throw new Error("Failed to determine agent template");
  }

  const agentDir = path.join(process.cwd(), "agent");

  try {
    await cloneGitHubSubdirectory(template, agentDir, spinner);

    // Create .env file in the agent directory
    spinner.text = chalk.cyan("Creating agent environment variables...");

    let envContent = "";

    // Add OpenAI API key if provided
    if (userAnswers.llmToken) {
      envContent += `OPENAI_API_KEY=${userAnswers.llmToken}\n`;
    }

    // Add LangSmith API key for LangGraph
    if (userAnswers.mode === "LangGraph" && userAnswers.langSmithApiKey) {
      envContent += `LANGSMITH_API_KEY=${userAnswers.langSmithApiKey}\n`;
    }

    if (envContent) {
      const agentEnvFile = path.join(agentDir, ".env");
      fs.writeFileSync(agentEnvFile, envContent, "utf8");
      spinner.text = chalk.cyan("Added API keys to agent .env file");
    }
  } catch (error) {
    spinner.fail(chalk.red("Failed to clone agent template"));
    throw error;
  }

  spinner.succeed(`${userAnswers.mode} agent cloned successfully`);
}

export const AgentTemplates = {
  LangGraph: {
    Starter: {
      Python:
        "https://github.com/CopilotKit/CopilotKit/tree/main/examples/starters/coagents-langgraph/agent-py",
      TypeScript:
        "https://github.com/CopilotKit/CopilotKit/tree/main/examples/starters/coagents-langgraph/agent-js",
    },
  },
  CrewAI: {
    Flows: {
      Starter:
        "https://github.com/CopilotKit/CopilotKit/tree/main/examples/starters/coagents-crewai-flows/agent-py",
    },
  },
};
