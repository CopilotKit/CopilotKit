import { graphql } from "../@generated/gql";

export const getAvailableAgentsQuery = graphql(/** GraphQL **/ `
  query availableAgents {
    availableAgents {
      agents {
        name
        id
        description
      }
    }
  }
`);

// input to the query:
// @InputType()
// export class LoadAgentStateInput {
//   @Field(() => String)
//   threadId: string;

//   @Field(() => String)
//   agentName: string;
// }

// output of the query:
// @ObjectType()
// export class LoadAgentStateResponse {
//   @Field(() => String)
//   threadId: string;

//   @Field(() => Boolean)
//   threadExists: boolean;

//   @Field(() => String)
//   state: string;

//   @Field(() => [BaseMessageOutput])
//   messages: (typeof BaseMessageOutput)[];
// }

export const loadAgentStateQuery = graphql(/** GraphQL **/ `
  query loadAgentState($data: LoadAgentStateInput!) {
    loadAgentState(data: $data) {
      threadId
      threadExists
      state
      messages
    }
  }
`);
