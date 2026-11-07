import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { makeCoreToolV5 } from "@mastra/core/utils";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("shared tool schema retention", () => {
  it("keeps injected resume parameters and the original input transform", async () => {
    const tool = createTool({
      id: "schema-validation",
      description: "Echo a location",
      inputSchema: z.object({ location: z.string().trim() }),
      execute: async ({ location }) => ({ location }),
    });
    const converted = makeCoreToolV5(
      tool,
      { name: tool.id, requestContext: new RequestContext() },
      "tool",
      true,
    );

    const schema = converted.inputSchema;
    if (!("jsonSchema" in schema)) {
      throw new Error("Converted tool must expose its JSON schema");
    }
    if (!converted.execute) {
      throw new Error("Converted tool must retain its executor");
    }

    expect(schema.jsonSchema.properties).toHaveProperty("suspendedToolRunId");
    expect(schema.jsonSchema.properties).toHaveProperty("resumeData");
    await expect(
      converted.execute(
        { location: " San Francisco " },
        { toolCallId: "schema-validation", messages: [] },
      ),
    ).resolves.toEqual({ location: "San Francisco" });
  });

  it.each(["background", "resume"] as const)(
    "does not retain a new validator on the shared tool for every %s conversion",
    (mode) => {
      const tool = createTool({
        id: "schema-retention",
        description: "Echo a location",
        inputSchema: z.object({ location: z.string().trim() }),
        execute: async ({ location }) => ({ location }),
      });
      const originalSchema = tool.inputSchema;

      // Mastra's background-enabled builder used to overwrite inputSchema
      // with a validator closing over the previous inputSchema on every run.
      // Thread-history eviction cannot release this chain: the agent owns the
      // shared tool for the entire process lifetime.
      for (let run = 0; run < 100; run++) {
        makeCoreToolV5(
          tool,
          {
            name: tool.id,
            requestContext: new RequestContext(),
            backgroundConfig: { enabled: true },
          },
          "tool",
          mode === "resume",
          mode === "background",
        );
      }

      expect(tool.inputSchema).toBe(originalSchema);
    },
  );
});
