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
const agentWithRemoteDeps = createAgentProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (Agent) - Remote Depenencies",
  dependencies: "Remote"
});

const uiWithRemoteDeps = createUIProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (UI) - Remote Depenencies",
  dependencies: "Remote",
  agentProject: agentWithRemoteDeps,
});

// Local Dependencies
const agentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (Agent) - Local Depenencies",
  dependencies: "Local"
});

const uiWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-research-canvas",
  description: "CoAgents Research Canvas (UI) - Local Depenencies",
  dependencies: "Local",
  agentProject: agentWithLocalDeps
});

/*
 * CoAgents Perplexity Demo
 */

// Remote Dependencies
const perplexityAgentWithRemoteDeps = createAgentProjectStack({
  app,
  project: "coagents-ai-researcher",
  description: "CoAgents Perplexity Clone (Agent) - Remote Dependencies",
  dependencies: "Remote"
});

const perplexityUIWithRemoteDeps = createUIProjectStack({
  app,
  project: "coagents-ai-researcher", 
  description: "CoAgents Perplexity Clone (UI) - Remote Dependencies",
  dependencies: "Remote",
  agentProject: perplexityAgentWithRemoteDeps
});

// Local Dependencies
const perplexityAgentWithLocalDeps = createAgentProjectStack({
  app,
  project: "coagents-ai-researcher",
  description: "CoAgents Perplexity Clone (Agent) - Local Dependencies",
  dependencies: "Local"
});

const perplexityUIWithLocalDeps = createUIProjectStack({
  app,
  project: "coagents-ai-researcher",
  description: "CoAgents Perplexity Clone (UI) - Local Dependencies",
  dependencies: "Local",
  agentProject: perplexityAgentWithLocalDeps
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
