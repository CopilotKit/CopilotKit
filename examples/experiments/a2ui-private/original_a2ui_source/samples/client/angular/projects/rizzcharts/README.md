# Angular A2UI - RIZZ Charts

These are sample implementations of A2UI in Angular.

## Prerequisites

1. [nodejs](https://nodejs.org/en)
2. GoogleMap API ([How to get the API key](https://developers.google.com/maps/documentation/javascript/get-api-key))

## Running

1. Update the `src/environments/environment.ts` file with your Google Maps API key. 
2. Build the shared dependencies by running `npm i`, then `npm run build` in the `renderers/lit` directory
3. Install the dependencies: `npm i`
4. Run the A2A server for the [rizzcharts agent](../../../../../a2a_agents/python/adk/samples/rizzcharts/)
5. Run the relevant app:
  * `npm start -- rizzcharts`
6. Open http://localhost:4200/