import { CopilotKitProps } from "../copilotkit-props";

describe("CopilotKit headers type", () => {
  test("should accept static headers object", () => {
    const props: CopilotKitProps = {
      children: null,
      headers: { Authorization: "Bearer token" },
    };
    expect(props.headers).toEqual({ Authorization: "Bearer token" });
  });

  test("should accept headers as a function returning object", () => {
    const headersFn = () => ({ Authorization: "Bearer dynamic" });
    const props: CopilotKitProps = {
      children: null,
      headers: headersFn,
    };
    expect(typeof props.headers).toBe("function");
  });

  test("should allow undefined headers", () => {
    const props: CopilotKitProps = {
      children: null,
    };
    expect(props.headers).toBeUndefined();
  });
});
