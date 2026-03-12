import spawn from "cross-spawn";
import { templateMapping, Config } from "../types/index.js";

export async function scaffoldShadCN(flags: any, userAnswers: Config) {
  try {
    // Determine which components to install based on user choices
    const components: string[] = [];

    // Add additional components based on agent framework
    switch (userAnswers.mode) {
      case "LangGraph":
        components.push(templateMapping.LangGraphGeneric);
        if (userAnswers.langGraphPlatform === "Yes") {
          components.push(templateMapping.LangGraphPlatformRuntime);
        } else {
          components.push(templateMapping.RemoteEndpoint);
        }
        break;
      case "CrewAI":
        if (userAnswers.crewType === "Crews") {
          components.push(...templateMapping.CrewEnterprise);
        } else if (userAnswers.crewType === "Flows") {
          components.push(...templateMapping.CrewFlowsEnterprise);
        } else {
          components.push(templateMapping.RemoteEndpoint);
        }
        break;
      case "MCP":
        components.push(templateMapping.McpStarter);
        if (
          userAnswers.deploymentChoice === "Self-hosted" ||
          userAnswers.useCopilotCloud === "No"
        ) {
          components.push(templateMapping.McpRuntime);
        }
        break;
      case "Standard":
        components.push(templateMapping.StandardStarter);
        if (
          userAnswers.deploymentChoice === "Self-hosted" ||
          userAnswers.useCopilotCloud === "No"
        ) {
          components.push(templateMapping.StandardRuntime);
        }
        break;
      default:
        return;
    }

    // Small pause before running shadcn
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // Run shadcn with inherited stdio for all streams to allow for user input
      const result = spawn.sync(
        "npx",
        ["shadcn@latest", "add", ...components],
        {
          stdio: "inherit", // This ensures stdin/stdout/stderr are all passed through
        },
      );

      if (result.status !== 0) {
        throw new Error(
          `The shadcn installation process exited with code ${result.status}`,
        );
      }
    } catch (error) {
      throw error;
    }
  } catch (error) {
    throw error;
  }
}
