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
        id
        role
        content @stream
        isStream
      }
      threadId
      runId
    }
  }
`);
