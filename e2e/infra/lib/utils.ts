import { App } from "aws-cdk-lib";
import { PreviewProjectStack } from "./demo-project-stack";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is missing`);
  }
  return value;
}

export function toCdkStackName(input: string) {
  return input
    .split("-") // Split the string by hyphens
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
    .join(""); // Join the words back together
}

export function createAgentProjectStack({
  app,
  project,
  description,
}: {
  app: App;
  project: string;
  description: string;
}): {
  selfHostedAgent: PreviewProjectStack;
  lgcAgentPython: PreviewProjectStack;
  lgcAgentJS: PreviewProjectStack;
} {
  const cdkStackName = toCdkStackName(project) + "AgentLocalDeps";
  const GITHUB_ACTIONS_RUN_ID = requireEnv("GITHUB_ACTIONS_RUN_ID");

  const outputs: Record<string, string> = {
    Dependencies: "Local",
  };

  if (process.env.GITHUB_PR_NUMBER) {
    outputs["PRNumber"] = process.env.GITHUB_PR_NUMBER;
  }

  const selfHostedAgent = new PreviewProjectStack(app, cdkStackName, {
    projectName: project,
    projectDescription: description,
    environmentVariablesFromSecrets: [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "TAVILY_API_KEY",
    ],
    port: "8000",
    includeInPRComment: false,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
    },
    imageTag: `${project}-agent-python-local-deps-${GITHUB_ACTIONS_RUN_ID}`,
    outputs: {
      ...outputs,
      LangGraphCloud: "false",
      SelfHosted: "true",
    },
  });

  const lgcAgentPython = new PreviewProjectStack(
    app,
    `${cdkStackName}LGCPython`,
    {
      projectName: project,
      projectDescription: `${description} - LangGraph Cloud Python`,
      environmentVariablesFromSecrets: [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
        "TAVILY_API_KEY",
        "LANGSMITH_API_KEY",
      ],
      environmentVariables: {
        LANGGRAPH_API: "true",
      },
      port: "8000",
      includeInPRComment: false,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
      },
      imageTag: `${project}-agent-python-local-deps-${GITHUB_ACTIONS_RUN_ID}`,
      entrypoint: ["/bin/sh", "-c"],
      cmd: [
        `cd /asset && langgraph dev --no-browser --port=8000 --config=langgraph.json --host=0.0.0.0`,
      ],
      outputs: {
        ...outputs,
        LangGraphCloud: "false",
        SelfHosted: "false",
      },
    }
  );

  const lgcAgentJS = new PreviewProjectStack(app, `${cdkStackName}LGCJS`, {
    projectName: project,
    projectDescription: `${description} - LangGraph Cloud JS`,
    environmentVariablesFromSecrets: [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "TAVILY_API_KEY",
      "LANGSMITH_API_KEY",
    ],
    environmentVariables: {
      HOME: "/tmp",
      PNPM_HOME: "/tmp/pnpm",
      COREPACK_HOME: "/tmp/corepack",
    },
    port: "8000",
    includeInPRComment: false,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
    },
    imageTag: `${project}-agent-js-local-deps-${GITHUB_ACTIONS_RUN_ID}`,
    outputs: {
      ...outputs,
      LangGraphCloud: "false",
      SelfHosted: "false",
    },
  });

  return { selfHostedAgent, lgcAgentPython, lgcAgentJS };
}

export function createUIProjectStack({
  app,
  project,
  description,
  selfHostedAgentProject,
  lgcAgentProjectPython,
  lgcAgentProjectJS,
  environmentVariables,
  environmentVariablesFromSecrets,
  customOutputs,
}: {
  app: App;
  project: string;
  description: string;
  selfHostedAgentProject: PreviewProjectStack;
  lgcAgentProjectPython: PreviewProjectStack;
  lgcAgentProjectJS: PreviewProjectStack;
  environmentVariables?: Record<string, string>;
  environmentVariablesFromSecrets?: string[];
  customOutputs?: Record<string, string>;
}) {
  const cdkStackName = toCdkStackName(project) + "UILocalDeps";
  const GITHUB_ACTIONS_RUN_ID = requireEnv("GITHUB_ACTIONS_RUN_ID");

  const outputs: Record<string, string> = {
    Dependencies: "Local",
    EndToEndProjectKey: `${project}-ui-deps-local`,
    LgcPythonDeploymentUrl: `${lgcAgentProjectPython.fnUrl}`,
    LgcJSDeploymentUrl: `${lgcAgentProjectJS.fnUrl}`,
  };

  if (customOutputs) {
    Object.assign(outputs, customOutputs);
  }

  if (process.env.GITHUB_PR_NUMBER) {
    outputs["PRNumber"] = process.env.GITHUB_PR_NUMBER;
  }

  return new PreviewProjectStack(app, cdkStackName, {
    projectName: project,
    projectDescription: `${description}`,
    environmentVariablesFromSecrets: [
      "OPENAI_API_KEY",
      "LANGSMITH_API_KEY",
      ...(environmentVariablesFromSecrets ?? []),
    ],
    environmentVariables: {
      REMOTE_ACTION_URL: `${selfHostedAgentProject.fnUrl}/copilotkit`,
      ...environmentVariables,
    },
    buildSecrets: ["OPENAI_API_KEY"],
    port: "3000",
    includeInPRComment: true,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
    },
    imageTag: `${project}-ui-${GITHUB_ACTIONS_RUN_ID}`,
    outputs,
  });
}

export function createNextOpenAIProjectStack({
  app,
  description,
  variant,
  environmentVariables,
  environmentVariablesFromSecrets,
}: {
  app: App;
  description: string;
  variant: "self-hosted";
  environmentVariables?: Record<string, string>;
  environmentVariablesFromSecrets?: string[];
}) {
  const cdkStackName = toCdkStackName(`next-openai-${variant}`);
  const GITHUB_ACTIONS_RUN_ID = requireEnv("GITHUB_ACTIONS_RUN_ID");

  const outputs: Record<string, string> = {
    Variant: variant,
    Dependencies: "Local",
    EndToEndProjectKey: `next-openai-${variant}`,
  };

  if (process.env.GITHUB_PR_NUMBER) {
    outputs["PRNumber"] = process.env.GITHUB_PR_NUMBER;
  }

  return new PreviewProjectStack(app, cdkStackName, {
    projectName: `next-openai`,
    projectDescription: `${description}`,
    environmentVariablesFromSecrets: [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "GROQ_API_KEY",
      ...(environmentVariablesFromSecrets ?? []),
    ],
    environmentVariables: {
      ...(environmentVariables ?? {}),
    },
    port: "3000",
    includeInPRComment: true,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
    },
    imageTag: `next-openai-${GITHUB_ACTIONS_RUN_ID}`,
    outputs,
  });
}
