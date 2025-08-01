#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { createDojoLambdaStack } from "../lib/utils";
import { MastraDynamoDbStack } from "../lib/mastra-dynamo-stack";
// app
const app = new cdk.App();

const parentStack = new cdk.Stack(app, 'E2E-Dojo',
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
    }
  })

const serverStarterAgent = createDojoLambdaStack({
  parentStack,
  name: "server-starter-agent",
  description: "The server starter agent for the dojo",
});

const serverStarterAllFeaturesAgent = createDojoLambdaStack({
  parentStack,
  name: "server-starter-all-features-agent",
  description: "The server starter all features agent for the dojo",
});

// const pydanticAI = createDojoLambdaStack({
//   parentStack,
//   name: "pydantic-ai-agent",
//   description: "The pydantic AI agent for the dojo",
// });

const mastraAgent = createDojoLambdaStack({
  parentStack,
  name: "mastra-agent",
  description: "The mastra agent for the dojo",
});

const langgraphFastAPI = createDojoLambdaStack({
  parentStack,
  name: "langgraph-fastapi-agent",
  description: "The langgraph fastapi agent for the dojo",
});

const agnoAgent = createDojoLambdaStack({
  parentStack,
  name: "agno-agent",
  description: "The agno agent for the dojo",
});

const llamaIndexAgent = createDojoLambdaStack({
  parentStack,
  name: "llama-index-agent",
  description: "The llama index agent for the dojo",
});

const crewAI = createDojoLambdaStack({
  parentStack,
  name: "crewai-agent",
  description: "The crew AI agent for the dojo",
});

// Used for the shared state memory for the colocated mastra agent
const mastraMemoryDynamoDBStack = new MastraDynamoDbStack(parentStack, "MastraMemoryDynamoDBStack");

const dojo = createDojoLambdaStack({
    parentStack,
    name: "dojo-next",
    description: "The nextjs server for the dojo",
    environmentVariables: {
        SERVER_STARTER_URL: serverStarterAgent.fnUrl,
        SERVER_STARTER_ALL_FEATURES_URL: serverStarterAllFeaturesAgent.fnUrl,
        // PYDANTIC_AI_URL: pydanticAI.fnUrl,
        MASTRA_AGENT_URL: mastraAgent.fnUrl,
        LANGGRAPH_URL: 'TODO: Max: this needs to be set up still',
        LANGGRAPH_FASTAPI_URL: langgraphFastAPI.fnUrl,
        AGNO_AGENT_URL: agnoAgent.fnUrl,
        LLAMA_INDEX_AGENT_URL: llamaIndexAgent.fnUrl,
        CREW_AI_URL: crewAI.fnUrl,
        DYNAMODB_TABLE_NAME: mastraMemoryDynamoDBStack.tableName
    }
});

parentStack.nestedStackParent