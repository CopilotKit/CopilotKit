/**
 * Copilot Runtime adapter for remote agents.
 */
import { writeJsonLineResponseToEventStream } from "../../lib/streaming";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";

export interface RemoteAgentAdapterParams {
  /**
   * The url to use.
   */
  url: string;
}

export class RemoteAgentAdapter implements CopilotServiceAdapter {
  private url: string;

  constructor(params: RemoteAgentAdapterParams) {
    this.url = params.url;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    // TODO: add graphqlContext and get logger
    // const logger = graphqlContext.logger.child({ component: "remote-actions.fetchRemoteActions" });

    const {
      messages,
      actions,
      model,
      threadId,
      runId,
      forwardedParameters,
      extensions,
      eventSource,
    } = request;
    // TODO: make a fetch request to the url
    // then stream the events one by one and write them to the eventSource
    // then return the threadId

    // TODO: need try catch or handled by writeJsonLineResponseToEventStream ?
    // probably need to check if response is ok and handle error, then let
    // writeJsonLineResponseToEventStream handle the rest

    console.log("fetching", this.url);
    const response = await fetch(this.url, {
      method: "POST",
      // TODO-crewai: add headers
      // headers,
      body: JSON.stringify({
        threadId,
        // TODO-crewai: add nodeName
        // nodeName,
        // TODO-crewai: add additionalMessages
        // messages: [...messages, ...additionalMessages],
        messages,
        // TODO-crewai: add state
        // state,
        // TODO-crewai: add properties
        // properties: graphqlContext.properties,
        actions,
        // TODO-crewai: filter actions
        // actions: actionInputsWithoutAgents.map((action) => ({
        //   name: action.name,
        //   description: action.description,
        //   parameters: JSON.parse(action.jsonSchema),
        // })),
      }),
    });

    if (!response.ok) {
      // TODO-crewai: log error
      // logger.error(
      //   { url, status: response.status, body: await response.text() },
      //   "Failed to execute remote agent",
      // );
      throw new Error("Failed to execute remote agent");
    }

    eventSource.stream(async (eventStream$) => {
      writeJsonLineResponseToEventStream(response.body!, eventStream$);
    });

    return {
      threadId,
    };
  }
}
