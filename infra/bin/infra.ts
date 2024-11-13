#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { requireEnv } from "../lib/utils";
import { PreviewProjectStack } from "../lib/demo-project";

// app
const app = new cdk.App();
const uniqueEnvironmentId = requireEnv("UNIQUE_ENV_ID");

/**
 * CoAgents Research Canvas Demo
 */

const researchCanvasAgent = new PreviewProjectStack(app, `CoAgentsResearchCanvasDemoAgent`, {
  projectName: "CoAgents Research Canvas - Agent",
  demoDir: "examples/coagents-research-canvas/agent",
  overrideDockerWorkdir: "./",
  overrideDockerfile: "examples/coagents-research-canvas/agent/Dockerfile", 
  uniqueEnvironmentId,
  environmentFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
  port: "8000",
  includeInPRComment: false,
});

const researchCanvasUI = new PreviewProjectStack(app, `CoAgentsResearchCanvasDemoUI`, {
  projectName: "CoAgents Research Canvas - UI",
  demoDir: "examples/coagents-research-canvas/ui",
  uniqueEnvironmentId,
  environmentFromSecrets: ["OPENAI_API_KEY"],
  environment: {
    REMOTE_ACTION_URL: `${researchCanvasAgent.fnUrl}/copilotkit`,
  },
  port: "3000",
  includeInPRComment: true,
});

/**
 * CoAgents Perplexity Demo
 */

const perplexityAgent = new PreviewProjectStack(app, `CoAgentsPerplexityDemoAgent`, {
  projectName: "CoAgents Perplexity Clone - Agent",
  demoDir: "examples/coagents-ai-researcher/agent",
  overrideDockerWorkdir: "./",
  overrideDockerfile: "examples/coagents-ai-researcher/agent/Dockerfile", 
  uniqueEnvironmentId,
  environmentFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
  port: "8000",
  includeInPRComment: false,
});

const perplexityUI = new PreviewProjectStack(app, `CoAgentsPerplexityDemoUI`, {
  projectName: "CoAgents Perplexity Clone - UI",
  demoDir: "examples/coagents-ai-researcher/ui",
  uniqueEnvironmentId,
  environmentFromSecrets: ["OPENAI_API_KEY"],
  environment: {
    REMOTE_ACTION_URL: `${perplexityAgent.fnUrl}/copilotkit`,
  },
  port: "3000",
  includeInPRComment: true,
});

/**
 * CoAgents QA Text Demo
 */

const qaTextAgent = new PreviewProjectStack(app, `CoAgentsQATextDemoAgent`, {
  projectName: "CoAgents QA Text - Agent",
  demoDir: "examples/coagents-ai-researcher/agent",
  overrideDockerWorkdir: "./",
  overrideDockerfile: "examples/coagents-ai-researcher/agent/Dockerfile", 
  uniqueEnvironmentId,
  environmentFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
  port: "8000",
  includeInPRComment: false,
});

const qaTextUI = new PreviewProjectStack(app, `CoAgentsQATextDemoUI`, {
  projectName: "CoAgents QA Text - UI",
  demoDir: "examples/coagents-qa-text/ui",
  uniqueEnvironmentId,
  environmentFromSecrets: ["OPENAI_API_KEY"],
  environment: {
    REMOTE_ACTION_URL: `${qaTextAgent.fnUrl}/copilotkit`,
  },
  port: "3000",
  includeInPRComment: true,
});

/**
 * CoAgents QA Native Demo
 */

const qaNativeAgent = new PreviewProjectStack(app, `CoAgentsQANativetDemoAgent`, {
  projectName: "CoAgents QA Native - Agent",
  demoDir: "examples/coagents-ai-researcher/agent",
  overrideDockerWorkdir: "./",
  overrideDockerfile: "examples/coagents-ai-researcher/agent/Dockerfile", 
  uniqueEnvironmentId,
  environmentFromSecrets: ["OPENAI_API_KEY", "TAVILY_API_KEY"],
  port: "8000",
  includeInPRComment: false,
});

const qaNativeAUI = new PreviewProjectStack(app, `CoAgentsQANativeDemoUI`, {
  projectName: "CoAgents QA Native - UI",
  demoDir: "examples/coagents-qa-native/ui",
  uniqueEnvironmentId,
  environmentFromSecrets: ["OPENAI_API_KEY"],
  environment: {
    REMOTE_ACTION_URL: `${qaNativeAgent.fnUrl}/copilotkit`,
  },
  port: "3000",
  includeInPRComment: true,
});