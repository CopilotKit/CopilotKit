#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { createAgentProjectStack, createUIProjectStack } from "../lib/utils";

// app
const app = new cdk.App();

/*
 * Research Canvas
 */

// Remote Dependencies
const coAgentsResearchCanvasAgentRemoteDeps = createAgentProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (Agent) - Remote Depenencies",
  dependencies: "Remote"
});

const coAgentsResearchCanvasUIWithRemoteDeps = createUIProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (UI) - Remote Depenencies",
  dependencies: "Remote",
  agentProject: coAgentsResearchCanvasAgentRemoteDeps
});

// Local Dependencies
const coAgentsResearchCanvasAgentLocalDeps = createAgentProjectStack({
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
  agentProject: coAgentsResearchCanvasAgentLocalDeps
});

/*
 * CoAgents Perplexity Demo
 */

// Remote Dependencies
const coAgentsRoutingWithRemoteDeps = createAgentProjectStack({
  app,
  project: "coagents-routing",
  description: "CoAgents Routing (Agent) - Remote Dependencies",
  dependencies: "Remote"
});

const coAgentsRoutingUIWithRemoteDeps = createUIProjectStack({
  app,
  project: "coagents-routing", 
  description: "CoAgents Routing (UI) - Remote Dependencies",
  dependencies: "Remote",
  agentProject: coAgentsRoutingWithRemoteDeps
});

// Local Dependencies
const coAgentsRoutingWithLocalDeps = createAgentProjectStack({
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
  agentProject: coAgentsRoutingWithLocalDeps
});

/*
 * CoAgents QA Text Demo
 */

// Remote Dependencies
const qaTextAgentWithRemoteDeps = createAgentProjectStack({
  app,
  project: "coagents-qa-text",
  description: "CoAgents QA Text (Agent) - Remote Dependencies",
  dependencies: "Remote"
});

const qaTextUIWithRemoteDeps = createUIProjectStack({
  app,
  project: "coagents-qa-text",
  description: "CoAgents QA Text (UI) - Remote Dependencies",
  dependencies: "Remote",
  agentProject: qaTextAgentWithRemoteDeps
});

// Local Dependencies
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
  agentProject: qaTextAgentWithLocalDeps
});

/*
 * CoAgents QA Native Demo
 */

// Remote Dependencies
const qaNativeAgentWithRemoteDeps = createAgentProjectStack({
  app,
  project: "coagents-qa-native",
  description: "CoAgents QA Native (Agent) - Remote Dependencies",
  dependencies: "Remote"
});

const qaNativeUIWithRemoteDeps = createUIProjectStack({
  app,
  project: "coagents-qa-native",
  description: "CoAgents QA Native (UI) - Remote Dependencies",
  dependencies: "Remote",
  agentProject: qaNativeAgentWithRemoteDeps
});

// Local Dependencies
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
  agentProject: qaNativeAgentWithLocalDeps
});
