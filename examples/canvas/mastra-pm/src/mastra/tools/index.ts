import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Define the handler for the weather tool
const getWeatherInfo = async (location: string) => {
  // Replace with an actual API call to a weather service
  console.log(`Fetching weather for ${location}...`);
  // Example data structure
  return { temperature: 20, conditions: "Sunny" };
};

// Define a tool for retrieving weather information
export const weatherTool = createTool({
  id: "Get Weather Information",
  description: `Fetches the current weather information for a given city`,
  inputSchema: z.object({
    location: z.string().describe("Location name"),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    conditions: z.string(),
  }),
  execute: async ({ context: { location } }) => {
    console.log("Using tool to fetch weather information for", location);
    return await getWeatherInfo(location);
  },
});