#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { createAgentProjectStack, createNextOpenAIProjectStack, createUIProjectStack } from "../lib/utils";

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
  agentProject: coAgentsResearchCanvasAgentRemoteDeps,
  environmentVariables: {
    LGC_DEPLOYMENT_URL: `https://coagents-research-canvas-br-cda7ddd686245735b2653e48370427b9.default.us.langgraph.app`,
  }
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
  agentProject: coAgentsResearchCanvasAgentLocalDeps,
  environmentVariables: {
    LGC_DEPLOYMENT_URL: `https://coagents-research-canvas-br-cda7ddd686245735b2653e48370427b9.default.us.langgraph.app`,
  }
});

/*
 * CoAgents Routing Demo
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
  agentProject: coAgentsRoutingWithRemoteDeps,
  environmentVariables: {
    LGC_DEPLOYMENT_URL: 'https://coagents-routing-lgc-b-378e0fb14e6e5209a83d53e5770ff5e4.default.us.langgraph.app',
  }
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
  agentProject: coAgentsRoutingWithLocalDeps,
  environmentVariables: {
    LGC_DEPLOYMENT_URL: 'https://coagents-routing-lgc-b-378e0fb14e6e5209a83d53e5770ff5e4.default.us.langgraph.app',
  }
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
  agentProject: qaTextAgentWithRemoteDeps,
  environmentVariables: {
    LGC_DEPLOYMENT_URL: `https://coagents-qa-text-lgc-b-bd46db04c2355d76834a998b20686272.default.us.langgraph.app`,
  }
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
  agentProject: qaTextAgentWithLocalDeps,
  environmentVariables: {
    LGC_DEPLOYMENT_URL: `https://coagents-qa-text-lgc-b-bd46db04c2355d76834a998b20686272.default.us.langgraph.app`,
  }
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
  agentProject: qaNativeAgentWithRemoteDeps,
  environmentVariables: {
    LGC_DEPLOYMENT_URL: `https://coagents-qa-native-lgc-b-60a07709d8f651c584bbe3cc8e74ae3c.default.us.langgraph.app`,
  }
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
  agentProject: qaNativeAgentWithLocalDeps,
  environmentVariables: {
    LGC_DEPLOYMENT_URL: `https://coagents-qa-native-lgc-b-60a07709d8f651c584bbe3cc8e74ae3c.default.us.langgraph.app`,
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