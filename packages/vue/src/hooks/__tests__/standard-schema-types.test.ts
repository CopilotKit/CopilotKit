import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { type } from "arktype";
import type { StandardSchemaV1, InferSchemaOutput } from "@copilotkit/shared";
import type {
  RenderToolProps,
  RenderToolInProgressProps,
  RenderToolExecutingProps,
  RenderToolCompleteProps,
} from "../use-render-tool";
import type { VueToolCallRenderer } from "../../types/vue-tool-call-renderer";

describe("RenderToolProps type inference", () => {
  describe("with Zod schemas", () => {
    type ZodSchema = z.ZodObject<{
      query: z.ZodString;
      limit: z.ZodOptional<z.ZodNumber>;
    }>;

    it("RenderToolInProgressProps has Partial parameters", () => {
      expectTypeOf<
        RenderToolInProgressProps<ZodSchema>["parameters"]
      >().toEqualTypeOf<
        Partial<{ query: string; limit?: number | undefined }>
      >();
      expectTypeOf<
        RenderToolInProgressProps<ZodSchema>["toolCallId"]
      >().toBeString();
    });

    it("RenderToolExecutingProps has full parameters", () => {
      expectTypeOf<
        RenderToolExecutingProps<ZodSchema>["parameters"]
      >().toEqualTypeOf<{ query: string; limit?: number | undefined }>();
      expectTypeOf<
        RenderToolExecutingProps<ZodSchema>["toolCallId"]
      >().toBeString();
    });

    it("RenderToolCompleteProps has full parameters and string result", () => {
      type Complete = RenderToolCompleteProps<ZodSchema>;
      expectTypeOf<Complete["parameters"]>().toEqualTypeOf<{
        query: string;
        limit?: number | undefined;
      }>();
      expectTypeOf<Complete["result"]>().toBeString();
      expectTypeOf<Complete["status"]>().toEqualTypeOf<"complete">();
      expectTypeOf<Complete["toolCallId"]>().toBeString();
    });

    it("RenderToolProps is a discriminated union", () => {
      type Props = RenderToolProps<ZodSchema>;
      expectTypeOf<Props>().toMatchTypeOf<{
        name: string;
        toolCallId: string;
      }>();
    });
  });

  describe("with Valibot schemas", () => {
    it("infers Partial parameters for inProgress", () => {
      const schema = v.object({
        city: v.string(),
        temp: v.number(),
      });
      type S = typeof schema;

      expectTypeOf<RenderToolInProgressProps<S>["parameters"]>().toEqualTypeOf<
        Partial<{ city: string; temp: number }>
      >();
    });

    it("infers full parameters for executing", () => {
      const schema = v.object({
        city: v.string(),
      });
      type S = typeof schema;

      expectTypeOf<RenderToolExecutingProps<S>["parameters"]>().toEqualTypeOf<{
        city: string;
      }>();
    });
  });

  describe("with ArkType schemas", () => {
    it("infers Partial parameters for inProgress", () => {
      const schema = type({
        query: "string",
        limit: "number",
      });
      type S = typeof schema;

      expectTypeOf<RenderToolInProgressProps<S>["parameters"]>().toEqualTypeOf<
        Partial<{ query: string; limit: number }>
      >();
    });

    it("infers full parameters for complete", () => {
      const schema = type({
        query: "string",
      });
      type S = typeof schema;

      expectTypeOf<RenderToolCompleteProps<S>["parameters"]>().toEqualTypeOf<{
        query: string;
      }>();
    });
  });
});

describe("VueToolCallRenderer type inference", () => {
  it("args field accepts a StandardSchemaV1", () => {
    expectTypeOf<VueToolCallRenderer<{ x: number }>["args"]>().toMatchTypeOf<
      StandardSchemaV1<any, { x: number }>
    >();
  });
});

describe("useComponent type inference", () => {
  it("InferRenderProps extracts output from StandardSchemaV1", () => {
    type InferRenderProps<T> = T extends StandardSchemaV1
      ? InferSchemaOutput<T>
      : any;

    const zodSchema = z.object({ city: z.string() });
    expectTypeOf<InferRenderProps<typeof zodSchema>>().toEqualTypeOf<{
      city: string;
    }>();

    const valibotSchema = v.object({ query: v.string() });
    expectTypeOf<InferRenderProps<typeof valibotSchema>>().toEqualTypeOf<{
      query: string;
    }>();

    const arktypeSchema = type({ id: "string" });
    expectTypeOf<InferRenderProps<typeof arktypeSchema>>().toEqualTypeOf<{
      id: string;
    }>();
  });

  it("InferRenderProps returns any for undefined", () => {
    type InferRenderProps<T> = T extends StandardSchemaV1
      ? InferSchemaOutput<T>
      : any;

    expectTypeOf<InferRenderProps<undefined>>().toBeAny();
  });
});
