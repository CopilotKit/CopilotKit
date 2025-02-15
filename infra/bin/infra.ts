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
});

const coAgentsResearchCanvasUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (UI) - Local Depenencies",
  selfHostedAgentProject: coAgentsResearchCanvasAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: coAgentsResearchCanvasAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: coAgentsResearchCanvasAgentWithLocalDeps.lgcAgentJS,
});

/*
 * CoAgents Routing Demo
 */

const coAgentsRoutingAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-routing",
  description: "CoAgents Routing (Agent) - Local Dependencies",
});

const coAgentsRoutingUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-routing",
  description: "CoAgents Routing (UI) - Local Dependencies",
  selfHostedAgentProject: coAgentsRoutingAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: coAgentsRoutingAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: coAgentsRoutingAgentWithLocalDeps.lgcAgentJS,
});

/*
 * CoAgents QA Text Demo
 */

const qaTextAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-qa-text",
  description: "CoAgents QA Text (Agent) - Local Dependencies",
});

const qaTextUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-qa-text",
  description: "CoAgents QA Text (UI) - Local Dependencies",
  selfHostedAgentProject: qaTextAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: qaTextAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: qaTextAgentWithLocalDeps.lgcAgentJS,
});

/*
 * CoAgents QA Native Demo
 */

const qaNativeAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-qa-native",
  description: "CoAgents QA Native (Agent) - Local Dependencies",
});

const qaNativeUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-qa-native",
  description: "CoAgents QA Native (UI) - Local Dependencies",
  selfHostedAgentProject: qaNativeAgentWithLocalDeps.selfHostedAgent,
  lgcAgentProjectPython: qaNativeAgentWithLocalDeps.lgcAgentPython,
  lgcAgentProjectJS: qaNativeAgentWithLocalDeps.lgcAgentJS,
});

/**
 * Next OpenAI Demo
 */
createNextOpenAIProjectStack({
  app,
  description: "Next OpenAI - Self Hosted",
  variant: "self-hosted",
});