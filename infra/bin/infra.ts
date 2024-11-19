#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { requireEnv, toCdkStackName } from "../lib/utils";
import { PreviewProjectStack } from "../lib/demo-project-stack";

const GITHUB_ACTIONS_RUN_ID = requireEnv("GITHUB_ACTIONS_RUN_ID");

// app
const app = new cdk.App();

/*
 * Research Canvas
 */

// Remote Dependencies
const agentWithRemoteDeps = createAgentProjectStack({
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (Agent) - Remote Depenencies",
  dependencies: "Remote"
});

const uiWithRemoteDeps = createUIProjectStack({
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (UI) - Remote Depenencies",
  dependencies: "Remote",
  agentProject: agentWithRemoteDeps
});

// Local Dependencies
const agentWithLocalDeps = createAgentProjectStack({
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (Agent) - Local Depenencies",
  dependencies: "Local"
});

const uiWithLocalDeps = createUIProjectStack({
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (UI) - Local Depenencies",
  dependencies: "Local",
  agentProject: agentWithLocalDeps
});

function createAgentProjectStack({
  project,
  description,
  dependencies
}: {
  project: string;
  description: string;
  dependencies: "Remote" | "Local";
}) {
  const cdkStackName = toCdkStackName(project) + "Agent" + dependencies + "Deps";
  const dockerfile = dependencies === "Remote" ? `examples/Dockerfile.agent-remote-deps` : `examples/Dockerfile.agent-local-deps`;

  return new PreviewProjectStack(app, cdkStackName, {
    projectName: project,
    projectDescription: description,
    demoDir: `examples/${project}/agent`,
    overrideDockerfile: dockerfile,
    environmentVariablesFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
    port: "8000",
    includeInPRComment: false,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
    },
    imageTag: `${project}-agent-${dependencies === "Remote" ? "remote-deps" : "local-deps"}-${GITHUB_ACTIONS_RUN_ID}`
  });
}

function createUIProjectStack({
  project,
  description,
  dependencies,
  agentProject
}: {
  project: string;
  description: string;
  dependencies: "Remote" | "Local";
  agentProject: PreviewProjectStack;
}) {
  const cdkStackName = toCdkStackName(project) + "UI" + dependencies + "Deps";
  const dockerfile = dependencies === "Remote" ? `examples/Dockerfile.ui-remote-deps` : `examples/Dockerfile.ui-local-deps`;

  return new PreviewProjectStack(app, cdkStackName, {
    projectName: project,
    projectDescription: `${description} (Dependencies: ${dependencies})`,
    demoDir: `examples/${project}/ui`,
    overrideDockerfile: dockerfile,
    environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
    environmentVariables: {
      REMOTE_ACTION_URL: `${agentProject.fnUrl}/copilotkit`,
    },
    buildSecrets: ["OPENAI_API_KEY"],
    port: "3000",
    includeInPRComment: true,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
    },
    imageTag: `${project}-ui-${dependencies === "Remote" ? "remote-deps" : "local-deps"}-${GITHUB_ACTIONS_RUN_ID}`
  });
}

// const researchCanvasUIVersionedDeps = new PreviewProjectStack(app, `CoAgentsResearchCanvasDemoUIVersionedDeps`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents Research Canvas - UI",
//   demoDir: "examples/coagents-research-canvas/ui",
//   ecrImageTag: `coagents-research-canvas-ui-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.ui",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   environmentVariables: {
//     REMOTE_ACTION_URL: `${researchCanvasAgent.fnUrl}/copilotkit`,
//   },
//   port: "3000",
//   includeInPRComment: true,
//   outputEnvVariable: "COAGENTS_RESEARCH_CANVAS_UI_ENDPOINT_URL"
// });

// const researchCanvasAgent = new PreviewProjectStack(app, `CoAgentsResearchCanvasDemoAgent`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents Research Canvas - Agent",
//   demoDir: "examples/coagents-research-canvas/agent",
//   ecrImageTag: `coagents-research-canvas-agent-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.agent",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
//   port: "8000",
//   includeInPRComment: false,
//   outputEnvVariable: "COAGENTS_RESEARCH_CANVAS_AGENT_ENDPOINT_URL",
// });

// const researchCanvasUI = new PreviewProjectStack(app, `CoAgentsResearchCanvasDemoUI`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents Research Canvas - UI",
//   demoDir: "examples/coagents-research-canvas/ui",
//   ecrImageTag: `coagents-research-canvas-ui-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.ui",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   environmentVariables: {
//     REMOTE_ACTION_URL: `${researchCanvasAgent.fnUrl}/copilotkit`,
//   },
//   port: "3000",
//   includeInPRComment: true,
//   outputEnvVariable: "COAGENTS_RESEARCH_CANVAS_UI_ENDPOINT_URL"
// });

// /**
//  * CoAgents Perplexity Demo
//  */

// const perplexityAgent = new PreviewProjectStack(app, `CoAgentsPerplexityDemoAgent`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents Perplexity Clone - Agent",
//   demoDir: "examples/coagents-ai-researcher/agent",
//   ecrImageTag: `coagents-research-canvas-agent-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.agent",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
//   port: "8000",
//   includeInPRComment: false,
//   outputEnvVariable: "COAGENTS_PERPLEXITY_AGENT_ENDPOINT_URL",
// });

// const perplexityUI = new PreviewProjectStack(app, `CoAgentsPerplexityDemoUI`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents Perplexity Clone - UI",
//   demoDir: "examples/coagents-ai-researcher/ui",
//   ecrImageTag: `coagents-ai-researcher-ui-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.ui",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   environmentVariables: {
//     // REMOTE_ACTION_URL: `${perplexityAgent.fnUrl}/copilotkit`,
//   },
//   port: "3000",
//   includeInPRComment: true,
//   outputEnvVariable: "COAGENTS_PERPLEXITY_UI_ENDPOINT_URL",
// });

// /**
//  * CoAgents QA Text Demo
//  */

// const qaTextAgent = new PreviewProjectStack(app, `CoAgentsQATextDemoAgent`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents QA Text - Agent",
//   demoDir: "examples/coagents-ai-researcher/agent",
//   ecrImageTag: `coagents-ai-researcher-agent-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.agent",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
//   port: "8000",
//   includeInPRComment: false,
//   outputEnvVariable: "COAGENTS_QA_TEXT_AGENT_ENDPOINT_URL",
// });

// const qaTextUI = new PreviewProjectStack(app, `CoAgentsQATextDemoUI`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents QA Text - UI",
//   demoDir: "examples/coagents-qa-text/ui",
//   ecrImageTag: `coagents-qa-text-ui-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.ui",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   environmentVariables: {
//     // REMOTE_ACTION_URL: `${qaTextAgent.fnUrl}/copilotkit`,
//   },
//   port: "3000",
//   includeInPRComment: true,
//   outputEnvVariable: "COAGENTS_QA_TEXT_UI_ENDPOINT_URL",
// });

// /**
//  * CoAgents QA Native Demo
//  */

// const qaNativeAgent = new PreviewProjectStack(app, `CoAgentsQANativetDemoAgent`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents QA Native - Agent",
//   demoDir: "examples/coagents-ai-researcher/agent",
//   ecrImageTag: `coagents-qa-native-agent-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.agent",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   port: "8000",
//   includeInPRComment: false,
//   outputEnvVariable: "COAGENTS_QA_NATIVE_AGENT_ENDPOINT_URL",
// });

// const qaNativeAUI = new PreviewProjectStack(app, `CoAgentsQANativeDemoUI`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents QA Native - UI",
//   demoDir: "examples/coagents-qa-native/ui",
//   ecrImageTag: `coagents-qa-native-ui-${githubRunId}`,
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.ui",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   environmentVariables: {
//     // REMOTE_ACTION_URL: `${qaNativeAgent.fnUrl}/copilotkit`,
//   },
//   port: "3000",
//   includeInPRComment: true,
//   outputEnvVariable: "COAGENTS_QA_NATIVE_UI_ENDPOINT_URL",
// });
