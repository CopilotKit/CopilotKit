// @region[weather-tool-backend]
export const weatherTool = {
  name: "get_weather",
  description: "Get the current weather for a given location.",
  parameters: {
    type: "object" as const,
    properties: {
      location: { type: "string" as const, description: "City name" },
    },
    required: ["location"],
    additionalProperties: false,
  },
  handler: async (input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !("location" in input) ||
      typeof input.location !== "string"
    ) {
      throw new Error("location must be a string");
    }
    return {
      city: input.location,
      temperature: 68,
      humidity: 55,
      wind_speed: 10,
      conditions: "Sunny",
    };
  },
};
// @endregion[weather-tool-backend]
