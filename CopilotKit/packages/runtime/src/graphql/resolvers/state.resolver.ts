import { Arg, Resolver } from "type-graphql";
import { Ctx } from "type-graphql";
import { Query } from "type-graphql";
import { LoadAgentStateResponse } from "../types/load-agent-state-response.type";
import type { GraphQLContext } from "../../lib/integrations";
import { LoadAgentStateInput } from "../inputs/load-agent-state.input";
import { CopilotKitAgentDiscoveryError } from "@copilotkit/shared";

@Resolver(() => LoadAgentStateResponse)
export class StateResolver {
  @Query(() => LoadAgentStateResponse)
  async loadAgentState(@Ctx() ctx: GraphQLContext, @Arg("data") data: LoadAgentStateInput) {
    const agents = await ctx._copilotkit.runtime.getAllAgents(ctx);
    const hasAgent = agents.some((agent) => agent.name === data.agentName);
    if (!hasAgent) {
      throw new CopilotKitAgentDiscoveryError({
        agentName: data.agentName,
        availableAgents: agents.map((a) => ({ name: a.name, id: a.name })),
      });
    }

    const state = await ctx._copilotkit.runtime.loadAgentState(ctx, data.threadId, data.agentName);

    return state;
  }
}
