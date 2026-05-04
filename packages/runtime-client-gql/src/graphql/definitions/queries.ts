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
