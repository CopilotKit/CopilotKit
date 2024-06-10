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
        ... on BaseMessageOutput {
          id
          role
        }
        ... on BaseMessageOutput @defer {
          status {
            isDoneStreaming
          }
        }
        ... on TextMessageOutput {
          content @stream
        }
        ... on ActionExecutionMessageOutput {
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
