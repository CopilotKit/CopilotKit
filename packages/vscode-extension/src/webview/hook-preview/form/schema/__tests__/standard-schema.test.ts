import { describe, it, expect } from "vitest";
import { z } from "zod";
import { standardSchemaToFormSchema } from "../standard-schema";

describe("standardSchemaToFormSchema", () => {
  it("converts a zod object", () => {
    const schema = z.object({
      text: z.string(),
      priority: z.enum(["low", "high"]),
      done: z.boolean().optional(),
    });
    const out = standardSchemaToFormSchema(schema);
    expect(out.fields.map((f) => ({ name: f.name, kind: f.kind }))).toEqual([
      { name: "text", kind: "string" },
      { name: "priority", kind: "string" },
      { name: "done", kind: "boolean" },
    ]);
    const priority = out.fields.find((f) => f.name === "priority");
    expect(priority).toMatchObject({ kind: "string", enum: ["low", "high"] });
    expect(out.fields.find((f) => f.name === "text")!.required).toBe(true);
    expect(out.fields.find((f) => f.name === "done")!.required).toBe(false);
  });

  it("falls back to raw-json for non-zod vendors", () => {
    const fake = {
      "~standard": {
        vendor: "unknown-vendor",
        version: 1,
        validate: () => ({ value: {} }),
      },
    } as any;
    const out = standardSchemaToFormSchema(fake);
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0].kind).toBe("raw-json");
    expect((out.fields[0] as any).hint).toMatch(/unknown-vendor/);
  });

  it("returns raw-json when vendor field is missing", () => {
    const out = standardSchemaToFormSchema({} as any);
    expect(out.fields[0].kind).toBe("raw-json");
  });
});
