#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { requireEnv } from "../lib/utils";
import { PreviewProjectStack } from "../lib/demo-project-stack";

// app
const app = new cdk.App();
const uniqueEnvironmentId = requireEnv("UNIQUE_ENV_ID");

/**
 * CoAgents Research Canvas Demo
 */

// const researchCanvasAgent = new PreviewProjectStack(app, `CoAgentsResearchCanvasDemoAgent`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents Research Canvas - Agent",
//   demoDir: "examples/coagents-research-canvas/agent",
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.agent",
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
//   port: "8000",
//   includeInPRComment: false,
//   outputEnvVariable: "COAGENTS_RESEARCH_CANVAS_AGENT_ENDPOINT_URL",
// });

const researchCanvasUI = new PreviewProjectStack(app, `CoAgentsResearchCanvasDemoUI`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  projectName: "CoAgents Research Canvas - UI",
  demoDir: "examples/coagents-research-canvas/ui",
  ecrImageTag: `coagents-research-canvas-ui-${process.env.GITHUB_RUN_ID ?? "latest"}`,
  overrideDockerWorkdir: "./",
  overrideDockerfile: "examples/Dockerfile.ui", 
  uniqueEnvironmentId,
  environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
  buildSecrets: ["OPENAI_API_KEY"],
  environmentVariables: {
    // REMOTE_ACTION_URL: `${researchCanvasAgent.fnUrl}/copilotkit`,
  },
  port: "3000",
  includeInPRComment: true,
  outputEnvVariable: "COAGENTS_RESEARCH_CANVAS_UI_ENDPOINT_URL"
});

// /**
//  * CoAgents Perplexity Demo
//  */

// const perplexityAgent = new PreviewProjectStack(app, `CoAgentsPerplexityDemoAgent`, {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   projectName: "CoAgents Perplexity Clone - Agent",
//   demoDir: "examples/coagents-ai-researcher/agent",
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
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.ui", 
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   environmentVariables: {
//     REMOTE_ACTION_URL: `${perplexityAgent.fnUrl}/copilotkit`,
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
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.ui", 
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   environmentVariables: {
//     REMOTE_ACTION_URL: `${qaTextAgent.fnUrl}/copilotkit`,
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
//   overrideDockerWorkdir: "./",
//   overrideDockerfile: "examples/Dockerfile.ui", 
//   uniqueEnvironmentId,
//   environmentVariablesFromSecrets: ["OPENAI_API_KEY"],
//   buildSecrets: ["OPENAI_API_KEY"],
//   environmentVariables: {
//     REMOTE_ACTION_URL: `${qaNativeAgent.fnUrl}/copilotkit`,
//   },
//   port: "3000",
//   includeInPRComment: true,
//   outputEnvVariable: "COAGENTS_QA_NATIVE_UI_ENDPOINT_URL",
// });