# A2UI Editor / Generator

This is a UI to generate and visualize A2UI responses.

## Prerequisites

1. A Gemini API key.
2. [nodejs](https://nodejs.org/en)

## Running

1. Create a `.env` file in your clone of this directory.
2. In the `.env` file place your Gemini API Key: `GEMINI_API_KEY=<your key>`.
3. Install the dependencies: `npm i`
4. Run the dev server: `npm run dev`
5. Open http://localhost:5173/ for the Editor

If you do not have a `.env` file with a GEMINI_API_KEY value set the developer
server will not start. It will instead provide you with an error message
requesting that you place a Gemini API key in a `.env` file.
