import { Arg, Resolver } from "type-graphql";
import { Ctx } from "type-graphql";
import { Mutation } from "type-graphql";
import { GraphQLError } from "graphql";
import { ReinforcementLearningStateResponse } from "../types/reinforcement-learning-state-response.type";
import type { GraphQLContext } from "../../lib/integrations";
import { CommitReinforcementLearningStateInput } from "../inputs/reinforcement-learning.input";
import { fetchWithRetry } from "../../lib/runtime/retry-utils";

@Resolver(() => ReinforcementLearningStateResponse)
export class ReinforcementLearningStateResolver {
  @Mutation(() => ReinforcementLearningStateResponse)
  async commitReinforcementLearningState(
    @Ctx() ctx: GraphQLContext,
    @Arg("data") data: CommitReinforcementLearningStateInput,
  ) {
    let logger = ctx.logger.child({
      component: "ReinforcementLearningStateResolver.commitReinforcementLearningState",
    });

    const copilotRuntime = ctx._copilotkit.runtime;

    let copilotCloudPublicApiKey: string | null = null;
    let copilotCloudBaseUrl: string;

    // Extract publicApiKey from headers for both cloud and non-cloud requests
    // This enables onTrace functionality regardless of cloud configuration
    const publicApiKeyFromHeaders = ctx.request.headers.get("x-copilotcloud-public-api-key");
    if (publicApiKeyFromHeaders) {
      copilotCloudPublicApiKey = publicApiKeyFromHeaders;
    }

    if (!copilotCloudPublicApiKey) {
      logger.error("Public API key not found in headers");

      await copilotRuntime.errorGraphQLError(
        {
          message: "X-CopilotCloud-Public-API-Key header is required",
          code: "MISSING_PUBLIC_API_KEY",
          type: "GraphQLError",
        },
        {
          operation: "commitReinforcementLearningState",
          cloudConfigPresent: false,
          guardrailsEnabled: false,
        },
      );

      throw new GraphQLError("X-CopilotCloud-Public-API-Key header is required");
    }

    if (process.env.COPILOT_CLOUD_BASE_URL) {
      copilotCloudBaseUrl = process.env.COPILOT_CLOUD_BASE_URL;
    } else if (ctx._copilotkit.cloud?.baseUrl) {
      copilotCloudBaseUrl = ctx._copilotkit.cloud?.baseUrl;
    } else {
      copilotCloudBaseUrl = "https://api.cloud.copilotkit.ai";
    }

    const reinforcementLearningAPIEndpoint = `${copilotCloudBaseUrl}/reinforcement-learning/v1/commit`;

    const response = await fetchWithRetry(
      reinforcementLearningAPIEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-copilotcloud-public-api-key": copilotCloudPublicApiKey,
        },
        body: JSON.stringify({
          threadId: data.threadId,
          agentName: data.agentName,
          humanEdit: data.humanEdit,
          aiEdit: data.aiEdit,
          initialState: data.initialState,
          state: data.state,
        }),
      },
      logger,
    );

    // Check if response is successful
    if (!response.ok) {
      let errorBody: any;
      try {
        errorBody = await response.json();
      } catch (parseError) {
        errorBody = { message: "Failed to parse error response" };
      }

      logger.error("Reinforcement learning API error", {
        status: response.status,
        statusText: response.statusText,
        errorBody,
      });

      throw new GraphQLError(
        `Reinforcement learning API error: ${errorBody.message || response.statusText}`,
        {
          extensions: {
            code: "RL_API_ERROR",
            status: response.status,
            details: errorBody,
          },
        },
      );
    }

    const state = await response.json();

    logger.info("Reinforcement learning state committed successfully");

    return state;
  }
}
