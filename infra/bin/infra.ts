#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CoAgentsDemoStack } from "../lib/coagents-demo-stack";
import * as path from "path";
import { requireEnv } from "../lib/utils";

// app
const app = new cdk.App();
const pullRequestNumber = requireEnv("GITHUB_PR_NUMBER");

new CoAgentsDemoStack(app, `ResearchCanvasDemoStackPr${pullRequestNumber}`, {
  pullRequestNumber: `${pullRequestNumber}`,
  projectName: "CoAgents Research Canvas",
  demoName: "coagents-research-canvas",
});

new CoAgentsDemoStack(app, `PerplexityDemoStackPr${pullRequestNumber}`, {
  pullRequestNumber: `${pullRequestNumber}`,
  projectName: "CoAgents Perplexity Clone",
  demoName: "coagents-ai-researcher",
});

new CoAgentsDemoStack(app, `CoAgentsQAText${pullRequestNumber}`, {
  pullRequestNumber: `${pullRequestNumber}`,
  projectName: "CoAgents Q&A Text",
  demoName: "coagents-qa-text",
});

new CoAgentsDemoStack(app, `CoAgentsQANative${pullRequestNumber}`, {
  pullRequestNumber: `${pullRequestNumber}`,
  projectName: "CoAgents Q&A Native",
  demoName: "coagents-qa-native",
});
