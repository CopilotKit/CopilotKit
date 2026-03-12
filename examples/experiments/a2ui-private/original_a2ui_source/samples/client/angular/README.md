# Angular A2UI

These are sample implementations of A2UI in Angular.

## Prerequisites

1. [nodejs](https://nodejs.org/en)

NOTE: [For the rizzcharts app](../../../a2a_agents/python/adk/samples/rizzcharts/), you will need GoogleMap API ([How to get the API key](https://developers.google.com/maps/documentation/javascript/get-api-key)) to display Google Map custome components. Please refer to [Rizzcharts README](./projects/rizzcharts/README.md)

## Running

1. Build the shared dependencies by running `npm run build` in the `renderers/lit` directory
2. Install the dependencies: `npm i`
3. Run the relevant A2A server:
  * [For the restaurant app](../../../a2a_agents/python/adk/samples/restaurant_finder/)
  * [For the contact app](../../../a2a_agents/python/adk/samples/contact_lookup/)
  * [For the rizzcharts app](../../../a2a_agents/python/adk/samples/rizzcharts/)
4. Run the relevant app:
  * `npm start -- restaurant`
  * `npm start -- contact`
  * `npm start -- rizzcharts`
5. Open http://localhost:4200/