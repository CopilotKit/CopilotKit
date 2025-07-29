import { Stack } from "aws-cdk-lib";
import { PreviewBaseLambdaStack } from "./base-lambda-stack";
// Import Node.js process global type for TypeScript

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

export function createDojoLambdaStack({
  parentStack,
  name,
  description,
  environmentVariables,
  environmentVariablesFromSecrets,
}: {
  parentStack: Stack;
  name: string;
  description: string;
  environmentVariables?: Record<string, string>;
  environmentVariablesFromSecrets?: string[];
}) {
  const projectName = `dojo-lambda-${name}`;
  const cdkStackName = toCdkStackName(projectName);
  const GITHUB_ACTIONS_RUN_ID = requireEnv("GITHUB_ACTIONS_RUN_ID");

  const outputs: Record<string, string> = {
    Name: name,
    EndToEndProjectKey: projectName,
  };

  if (process.env.GITHUB_PR_NUMBER) {
    outputs["PRNumber"] = process.env.GITHUB_PR_NUMBER;
  }

  return new PreviewBaseLambdaStack(parentStack, cdkStackName, {
    projectName: projectName,
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
    imageTag: `${name}-${GITHUB_ACTIONS_RUN_ID}`,
    outputs,
  });
}
