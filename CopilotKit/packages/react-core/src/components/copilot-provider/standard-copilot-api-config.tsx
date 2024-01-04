import { CopilotApiConfig } from "../../context/copilot-context";

/**
 * A standard implementation of the CopilotApiConfig interface.
 *
 * Pass in the base URL of the chat API, the headers to be sent with each request, and the body to be sent with each request.
 * The rest of the CopilotApiConfig interface is implemented by default.
 *
 */

export class StandardCopilotApiConfig implements CopilotApiConfig {
  chatApiEndpoint: string;
  chatApiEndpointV2: string;
  headers: Record<string, string>;
  body: Record<string, any>;

  constructor(
    chatApiEndpoint: string,
    chatApiEndpointV2: string,
    headers: Record<string, string>,
    body: Record<string, any>,
  ) {
    this.chatApiEndpoint = chatApiEndpoint;
    this.chatApiEndpointV2 = chatApiEndpointV2;
    this.headers = headers;
    this.body = body;
  }
}
