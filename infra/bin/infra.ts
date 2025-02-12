#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { createAgentProjectStack, createNextOpenAIProjectStack, createUIProjectStack } from "../lib/utils";

// app
const app = new cdk.App();

/*
 * Research Canvas
 */

const coAgentsResearchCanvasAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (Agent) - Local Depenencies",
  dependencies: "Local"
});

const coAgentsResearchCanvasUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (UI) - Local Depenencies",
  dependencies: "Local",
  selfHostedAgentProject: coAgentsResearchCanvasAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: coAgentsResearchCanvasAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: coAgentsResearchCanvasAgentWithLocalDeps.lgcAgentJS,
  environmentVariables: {},
  customOutputs: {
    "LgcJSDeploymentUrl": `https://coagents-research-canvas-st-08476feebc3a58e5925116da0d3ad635.default.us.langgraph.app`
  }
});

/*
 * Travel
 */

const coAgentsTravelAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-travel",
  description: "CoAgents Travel (Agent) - Local Depenencies",
  dependencies: "Local"
});

const coAgentsTravelUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-travel",
  description: "CoAgents Travel (UI) - Local Depenencies",
  dependencies: "Local",
  selfHostedAgentProject: coAgentsTravelAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: coAgentsTravelAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: coAgentsTravelAgentWithLocalDeps.lgcAgentJS,
  environmentVariables: {},
  customOutputs: {
    "LgcJSDeploymentUrl": `https://coagents-travel-st-08476feebc3a58e5925116da0d3ad635.default.us.langgraph.app`
  }
});

/*
 * CoAgents Routing Demo
 */

const coAgentsRoutingAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-routing",
  description: "CoAgents Routing (Agent) - Local Dependencies",
  dependencies: "Local"
});

const coAgentsRoutingUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-routing",
  description: "CoAgents Routing (UI) - Local Dependencies",
  dependencies: "Local",
  selfHostedAgentProject: coAgentsRoutingAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: coAgentsRoutingAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: coAgentsRoutingAgentWithLocalDeps.lgcAgentJS,
  environmentVariables: {},
  customOutputs: {
    "LgcJSDeploymentUrl": `https://coagents-routing-stg-js-4df4be4cab70578ca535df7e1c0b05cf.default.us.langgraph.app`
  }
});

/*
 * CoAgents QA Text Demo
 */

const qaTextAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-qa-text",
  description: "CoAgents QA Text (Agent) - Local Dependencies",
  dependencies: "Local"
});

const qaTextUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-qa-text",
  description: "CoAgents QA Text (UI) - Local Dependencies",
  dependencies: "Local",
  selfHostedAgentProject: qaTextAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: qaTextAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: qaTextAgentWithLocalDeps.lgcAgentJS,
  environmentVariables: {},
  customOutputs: {
    "LgcJSDeploymentUrl": `https://coagents-qa-text-stg-js-4d74616e480750d0a5d10d0c3c5d44a4.default.us.langgraph.app`
  }
});

/*
 * CoAgents QA Native Demo
 */

const qaNativeAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-qa-native",
  description: "CoAgents QA Native (Agent) - Local Dependencies",
  dependencies: "Local"
});

const qaNativeUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-qa-native",
  description: "CoAgents QA Native (UI) - Local Dependencies",
  dependencies: "Local",
  selfHostedAgentProject: qaNativeAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: qaNativeAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: qaNativeAgentWithLocalDeps.lgcAgentJS,
  environmentVariables: {},
  customOutputs: {
    "LgcJSDeploymentUrl": `https://coagents-qa-native-stg-js-036615e530e8593286ccf93d3003ffe2.default.us.langgraph.app`
  }
});

/**
 * Next OpenAI Demo
 */
createNextOpenAIProjectStack({
  app,
  description: "Next OpenAI - Self Hosted",
  variant: "self-hosted",
});