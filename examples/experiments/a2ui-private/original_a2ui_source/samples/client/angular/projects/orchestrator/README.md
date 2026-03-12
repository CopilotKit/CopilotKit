# Orchestrator

Sample application using the Chat-Canvas component orchestrating multiple A2A and A2UI Agents.

This angular app connects to an Orchastrator Agent which takes user messages and delegates tasks to its subagents based on the assessed context. 

## Prerequisites

1. [nodejs](https://nodejs.org/en)
2. GoogleMap API ([How to get the API key](https://developers.google.com/maps/documentation/javascript/get-api-key))
3. An endpoint hosting all of the A2AService. ([Review the instructions on how to run Orchestrator A2AService connecting to multiple A2A/A2UI Agents](../../../../../a2a_agents/python/adk/samples/orchestrator/README.me).)

## Running

1. Update the `src/environments/environment.ts` file with your Google Maps API key.
2. Build the shared dependencies by running `npm run build` in the `renderers/lit` directory
3. Install the dependencies: `npm i`
4. Run the A2A server for all of the agents. ([Link to instructions](../../../../../a2a_agents/python/adk/samples/orchestrator/README.me))
5. Run the app:

- `npm start -- orchestrator`

6. Open http://localhost:4200/
