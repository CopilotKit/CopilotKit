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
        ... on BaseMessage {
          id
          role
        }
        ... on BaseMessage @defer {
          status {
            isDoneStreaming
          }
        }
        ... on TextMessage {
          content @stream
        }
        ... on ActionExecutionMessage {
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
