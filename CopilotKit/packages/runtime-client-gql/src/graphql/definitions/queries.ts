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
