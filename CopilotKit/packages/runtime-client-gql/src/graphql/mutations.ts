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
          createdAt
        }
        ... on BaseMessageOutput @defer {
          status {
            isDoneStreaming
          }
        }
        ... on TextMessageOutput {
          content @stream
          role
        }
        ... on ActionExecutionMessageOutput {
          name
          scope
          arguments @stream
        }
        ... on ResultMessageOutput {
          result
          actionExecutionId
          actionName
        }
      }
      threadId
      runId
    }
  }
`);
