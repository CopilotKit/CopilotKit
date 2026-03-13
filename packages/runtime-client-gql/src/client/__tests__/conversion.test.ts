import { describe, it, expect } from "vitest";
import { convertGqlOutputToMessages } from "../conversion";

describe("getPartialArguments non-object guard", () => {
  function makeActionOutput(argsFragments: string[]) {
    return [
      {
        __typename: "ActionExecutionMessageOutput" as const,
        id: "msg-1",
        name: "myAction",
        arguments: argsFragments,
        parentMessageId: undefined,
        status: { code: "Pending" },
      },
    ];
  }

  it("passes through valid object arguments", () => {
    const messages = convertGqlOutputToMessages(
      makeActionOutput(['{"key":"val"}']) as any,
    );
    expect((messages[0] as any).arguments).toEqual({ key: "val" });
  });

  it("replaces a string argument with an empty object", () => {
    const messages = convertGqlOutputToMessages(
      makeActionOutput(['""']) as any,
    );
    expect((messages[0] as any).arguments).toEqual({});
  });

  it("replaces an array argument with an empty object", () => {
    const messages = convertGqlOutputToMessages(
      makeActionOutput(["[1,2]"]) as any,
    );
    expect((messages[0] as any).arguments).toEqual({});
  });

  it("replaces null with an empty object", () => {
    const messages = convertGqlOutputToMessages(
      makeActionOutput(["null"]) as any,
    );
    expect((messages[0] as any).arguments).toEqual({});
  });

  it("replaces a number with an empty object", () => {
    const messages = convertGqlOutputToMessages(
      makeActionOutput(["99"]) as any,
    );
    expect((messages[0] as any).arguments).toEqual({});
  });

  it("returns empty object for empty arguments array", () => {
    const messages = convertGqlOutputToMessages(makeActionOutput([]) as any);
    expect((messages[0] as any).arguments).toEqual({});
  });

  it("returns empty object for unparseable JSON", () => {
    const messages = convertGqlOutputToMessages(
      makeActionOutput(["{broken"]) as any,
    );
    expect((messages[0] as any).arguments).toEqual({});
  });
});
