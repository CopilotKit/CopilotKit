import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Section } from "@copilotkit/channels-core";
import { createChannelA2UICatalog } from "./catalog.js";

describe("createChannelA2UICatalog", () => {
  it("keeps executable lowerers local and emits one model-facing catalog schema", () => {
    const catalog = createChannelA2UICatalog(
      {
        ServiceStatus: {
          description: "Deployment status for one named service",
          props: z
            .object({
              service: z.string(),
              status: z.enum(["healthy", "failed"]),
            })
            .strict(),
        },
      },
      {
        ServiceStatus: ({ props }) =>
          Section({ children: `${props.service}: ${props.status}` }),
      },
      {
        catalogId: "copilotkit://channels-mvp/v1",
      },
    );

    expect(catalog.id).toBe("copilotkit://channels-mvp/v1");
    expect(catalog.processorCatalog.components.has("ServiceStatus")).toBe(true);
    expect(catalog.processorCatalog.components.has("Text")).toBe(false);
    expect(catalog.schema.catalogId).toBe(catalog.id);
    expect(catalog.schema.components.ServiceStatus).toMatchObject({
      description: "Deployment status for one named service",
    });
    expect(JSON.stringify(catalog.schema)).not.toContain("lower");
  });

  it("rejects a custom component that shadows the Channel-safe catalog", () => {
    expect(() =>
      createChannelA2UICatalog(
        { Text: { props: z.object({ value: z.string() }) } },
        { Text: () => "shadow" },
        { includeChannelBasicCatalog: true },
      ),
    ).toThrow(
      'Custom A2UI component "Text" conflicts with the Channel catalog',
    );
  });

  it("advertises exactly the Channel-safe basic subset", () => {
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        includeChannelBasicCatalog: true,
      },
    );

    expect([...catalog.processorCatalog.components.keys()].sort()).toEqual([
      "Button",
      "Card",
      "Column",
      "Divider",
      "Image",
      "Row",
      "Text",
    ]);
    expect(Object.keys(catalog.schema.components).sort()).toEqual([
      "Button",
      "Card",
      "Column",
      "Divider",
      "Image",
      "Row",
      "Text",
    ]);
  });
});
