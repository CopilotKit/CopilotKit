#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CoAgentsDemoStack } from "../lib/coagents-demo-stack";
import * as path from "path";

const app = new cdk.App();

new CoAgentsDemoStack(app, "ResearchCanvasDemoStack", {
  projectName: "CoAgents Research Canvas",
  demoPath: path.resolve(__dirname, "../../examples/coagents-research-canvas"),
});
