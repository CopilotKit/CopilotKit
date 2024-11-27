#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { createAgentProjectStack, createNextOpenAIProjectStack, createUIProjectStack } from "../lib/utils";

// app
const app = new cdk.App();

/*
 * Research Canvas
 */

// const coAgentsResearchCanvasAgentWithLocalDeps = createAgentProjectStack({
//   app,
//   project: "coagents-research-canvas",
//   description: "CoAgents Research Canvas (Agent) - Local Depenencies",
//   dependencies: "Local"
// });

// const coAgentsResearchCanvasUIWithLocalDeps = createUIProjectStack({
//   app,
//   project: "coagents-research-canvas",
//   description: "CoAgents Research Canvas (UI) - Local Depenencies",
//   dependencies: "Local",
//   selfHostedAgentProject: coAgentsResearchCanvasAgentWithLocalDeps.selfHostedAgent,
//   lgcAgentProjectPython: coAgentsResearchCanvasAgentWithLocalDeps.lgcAgentPython,
//   environmentVariables: {}
// });

// /*
//  * CoAgents Routing Demo
//  */

// const coAgentsRoutingAgentWithLocalDeps = createAgentProjectStack({
//   app,
//   project: "coagents-routing",
//   description: "CoAgents Routing (Agent) - Local Dependencies",
//   dependencies: "Local"
// });

// const coAgentsRoutingUIWithLocalDeps = createUIProjectStack({
//   app,
//   project: "coagents-routing",
//   description: "CoAgents Routing (UI) - Local Dependencies",
//   dependencies: "Local",
//   selfHostedAgentProject: coAgentsRoutingAgentWithLocalDeps.selfHostedAgent,
//   lgcAgentProjectPython: coAgentsRoutingAgentWithLocalDeps.lgcAgentPython,
//   environmentVariables: {}
// });

// /*
//  * CoAgents QA Text Demo
//  */

// const qaTextAgentWithLocalDeps = createAgentProjectStack({
//   app,
//   project: "coagents-qa-text",
//   description: "CoAgents QA Text (Agent) - Local Dependencies",
//   dependencies: "Local"
// });

// const qaTextUIWithLocalDeps = createUIProjectStack({
//   app,
//   project: "coagents-qa-text",
//   description: "CoAgents QA Text (UI) - Local Dependencies",
//   dependencies: "Local",
//   selfHostedAgentProject: qaTextAgentWithLocalDeps.selfHostedAgent,
//   lgcAgentProjectPython: qaTextAgentWithLocalDeps.lgcAgentPython,
//   environmentVariables: {}
// });

// /*
//  * CoAgents QA Native Demo
//  */

// const qaNativeAgentWithLocalDeps = createAgentProjectStack({
//   app,
//   project: "coagents-qa-native",
//   description: "CoAgents QA Native (Agent) - Local Dependencies",
//   dependencies: "Local"
// });

// const qaNativeUIWithLocalDeps = createUIProjectStack({
//   app,
//   project: "coagents-qa-native",
//   description: "CoAgents QA Native (UI) - Local Dependencies",
//   dependencies: "Local",
//   selfHostedAgentProject: qaNativeAgentWithLocalDeps.selfHostedAgent,
//   lgcAgentProjectPython: qaNativeAgentWithLocalDeps.lgcAgentPython,
//   environmentVariables: {}
// });

/**
 * Next OpenAI Demo
 */
createNextOpenAIProjectStack({
  app,
  description: "Next OpenAI - Self Hosted",
  variant: "self-hosted",
});