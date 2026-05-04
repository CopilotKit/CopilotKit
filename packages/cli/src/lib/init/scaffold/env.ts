import path from "path";
import fs from "fs";
import { Config } from "../types/index.js";
import { getLangGraphAgents } from "./langgraph-assistants.js";
import inquirer from "inquirer";
import { isLocalhost } from "../utils.js";

/**
 * Determines if cloud deployment is needed based on user answers
 * Uses the same logic as the main init flow to ensure consistency
 */
function needsCloudDeployment(userAnswers: Config): boolean {
  return (
    userAnswers.deploymentChoice === "Copilot Cloud" || // Branch B choice
    userAnswers.useCopilotCloud === "Yes" || // Branch C choice
    userAnswers.mode === "CrewAI" || // CrewAI always needs cloud
    (!userAnswers.deploymentChoice && !userAnswers.useCopilotCloud) // Branch A default (no questions = cloud)
  );
}

export async function scaffoldEnv(flags: any, userAnswers: Config) {
  try {
    // Define the env file path
    const envFile = path.join(process.cwd(), ".env");

    // Create the env file if it doesn't exist
    if (!fs.existsSync(envFile)) {
      fs.writeFileSync(envFile, "", "utf8");
    } else {
    }

    // Build environment variables based on user selections
    let newEnvValues = "";

    // Check if cloud deployment is needed
    const isCloudDeployment = needsCloudDeployment(userAnswers);

    // Copilot Cloud API key
    if (userAnswers.copilotCloudPublicApiKey) {
      newEnvValues += `NEXT_PUBLIC_COPILOT_API_KEY=${userAnswers.copilotCloudPublicApiKey}\n`;
    }

    // LangSmith API key (for LangGraph)
    if (userAnswers.langSmithApiKey) {
      // Add both formats for compatibility
      newEnvValues += `LANGSMITH_API_KEY=${userAnswers.langSmithApiKey}\n`;
    }

    // LLM API key - set as both LLM_TOKEN and OPENAI_API_KEY for compatibility
    if (userAnswers.llmToken) {
      newEnvValues += `OPENAI_API_KEY=${userAnswers.llmToken}\n`;
    }

    // CrewAI name
    if (userAnswers.crewName) {
      newEnvValues += `NEXT_PUBLIC_COPILOTKIT_AGENT_NAME=${userAnswers.crewName}\n`;
    }

    if (userAnswers.langGraphAgent) {
      newEnvValues += `NEXT_PUBLIC_COPILOTKIT_AGENT_NAME=sample_agent\n`;
      newEnvValues += `LANGGRAPH_DEPLOYMENT_URL=http://localhost:8123\n`;
    } else if (userAnswers.langGraphPlatform === "Yes" && !isCloudDeployment) {
      newEnvValues += `LANGGRAPH_DEPLOYMENT_URL=${userAnswers.langGraphPlatformUrl}\n`;
    } else if (userAnswers.langGraphRemoteEndpointURL) {
      newEnvValues += `COPILOTKIT_REMOTE_ENDPOINT=${userAnswers.langGraphRemoteEndpointURL}\n`;
    }

    // Runtime URL if provided via flags
    if (flags.runtimeUrl) {
      newEnvValues += `NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL=${flags.runtimeUrl}\n`;
    } else if (
      !isCloudDeployment &&
      userAnswers.crewType !== "Crews" &&
      userAnswers.crewType !== "Flows"
    ) {
      newEnvValues += `NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL=/api/copilotkit\n`;
    }

    if (
      userAnswers.langGraphPlatformUrl &&
      (userAnswers.langSmithApiKey ||
        isLocalhost(userAnswers.langGraphPlatformUrl))
    ) {
      const langGraphAgents = await getLangGraphAgents(
        userAnswers.langGraphPlatformUrl,
        userAnswers.langSmithApiKey || "",
      );
      let langGraphAgent = "";
      if (langGraphAgents.length > 1) {
        const { langGraphAgentChoice } = await inquirer.prompt([
          {
            type: "list",
            name: "langGraphAgentChoice",
            message: "🦜🔗 Which agent from your graph would you like to use?",
            choices: langGraphAgents.map((agent: any) => ({
              name: agent.graph_id,
              value: agent.graph_id,
            })),
          },
        ]);
        langGraphAgent = langGraphAgentChoice;
      } else if (langGraphAgents.length === 1) {
        langGraphAgent = langGraphAgents[0].graph_id;
      } else {
        throw new Error("No agents found in your LangGraph endpoint");
      }

      newEnvValues += `NEXT_PUBLIC_COPILOTKIT_AGENT_NAME=${langGraphAgent}\n`;
    }

    // Append the variables to the .env file
    if (newEnvValues) {
      fs.appendFileSync(envFile, newEnvValues);
    }
  } catch (error) {
    throw error;
  }
}
