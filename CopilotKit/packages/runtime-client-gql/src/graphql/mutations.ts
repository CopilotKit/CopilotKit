import { graphql } from "./@generated/gql";

export const generateResponseMutation = graphql(/** GraphQL **/ `
  mutation generateResponse($data: GenerateResponseInput!) {
    generateResponse(data: $data) {
      ... on GeneratedResponse @defer {
        interruption {
          interrupted
          reason
        }
      }
      messages @stream {
        __typename
        ... on TextMessage {
          id
          role
          content @stream
        }
        ... on ActionExecutionMessage {
          id
          role
          name
          scope
          arguments @stream
        }
      }
      threadId
      runId
    }
  }
`);
