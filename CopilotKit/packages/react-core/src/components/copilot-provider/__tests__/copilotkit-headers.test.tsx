/// <reference types="jest" />
import { CopilotKitProps, HeadersInput, HeadersFunction } from "../copilotkit-props";

describe("CopilotKit headers prop", () => {
  describe("type checking", () => {
    test("should accept static headers object", () => {
      const props: Partial<CopilotKitProps> = {
        headers: { Authorization: "token" },
      };
      expect(props.headers).toEqual({ Authorization: "token" });
    });

    test("should accept headers function", () => {
      const headersFn: HeadersFunction = () => ({ Authorization: "dynamic-token" });
      const props: Partial<CopilotKitProps> = {
        headers: headersFn,
      };
      expect(typeof props.headers).toBe("function");
    });

    test("should allow undefined headers", () => {
      const props: Partial<CopilotKitProps> = {};
      expect(props.headers).toBeUndefined();
    });
  });

  describe("HeadersInput type", () => {
    test("should allow Record<string, string> as HeadersInput", () => {
      const headers: HeadersInput = { "X-Custom": "value" };
      expect(headers).toEqual({ "X-Custom": "value" });
    });

    test("should allow function as HeadersInput", () => {
      const headers: HeadersInput = () => ({ "X-Custom": "dynamic" });
      expect(typeof headers).toBe("function");
      if (typeof headers === "function") {
        expect(headers()).toEqual({ "X-Custom": "dynamic" });
      }
    });

    test("should call headers function to resolve headers", () => {
      const headersFn = jest.fn(() => ({ Authorization: "Bearer dynamic-token" }));
      const headers: HeadersInput = headersFn;

      // Resolve headers
      const resolved = typeof headers === "function" ? headers() : headers;

      expect(headersFn).toHaveBeenCalledTimes(1);
      expect(resolved).toEqual({ Authorization: "Bearer dynamic-token" });
    });

    test("should call headers function multiple times for multiple requests", () => {
      let callCount = 0;
      const headersFn: HeadersFunction = () => {
        callCount++;
        return { Authorization: `Bearer token-${callCount}` };
      };

      // Simulate multiple request header resolutions
      const result1 = headersFn();
      const result2 = headersFn();
      const result3 = headersFn();

      expect(callCount).toBe(3);
      expect(result1).toEqual({ Authorization: "Bearer token-1" });
      expect(result2).toEqual({ Authorization: "Bearer token-2" });
      expect(result3).toEqual({ Authorization: "Bearer token-3" });
    });
  });
});
