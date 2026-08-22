import { describe, it, expect, vi } from "vitest";
import { getSdkClientOptions } from "../../../src/service-adapters/shared/sdk-client-utils";

describe("getSdkClientOptions()", () => {
  it("extracts defaultHeaders and fetch from _options", () => {
    const customFetch = vi.fn();
    const client = {
      _options: {
        defaultHeaders: { "x-api-key": "secret" },
        fetch: customFetch,
      },
    };

    const result = getSdkClientOptions(client);
    expect(result.defaultHeaders).toEqual({ "x-api-key": "secret" });
    expect(result.fetch).toBe(customFetch);
  });

  it("returns empty object when _options is missing", () => {
    const client = { baseURL: "https://api.example.com" };
    const result = getSdkClientOptions(client);
    expect(result).toEqual({});
  });

  it("returns empty object when _options is null", () => {
    const client = { _options: null };
    const result = getSdkClientOptions(client);
    expect(result).toEqual({});
  });

  it("returns empty object when _options is a primitive", () => {
    const client = { _options: "not-an-object" };
    const result = getSdkClientOptions(client);
    expect(result).toEqual({});
  });
});
