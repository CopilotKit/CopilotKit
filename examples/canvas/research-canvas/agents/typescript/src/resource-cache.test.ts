import { expect, test } from "vitest";
import { getOrLoadResource } from "./resource-cache";

test("retries a transient failure and caches the successful retry", async () => {
  const resourceUrl = "https://example.com/transient-resource";
  let attempts = 0;
  const load = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("Temporary network failure");
    }
    return "Downloaded resource";
  };

  await expect(getOrLoadResource(resourceUrl, load)).rejects.toThrow(
    "Temporary network failure",
  );
  await expect(getOrLoadResource(resourceUrl, load)).resolves.toBe(
    "Downloaded resource",
  );
  await expect(getOrLoadResource(resourceUrl, load)).resolves.toBe(
    "Downloaded resource",
  );

  expect(attempts).toBe(2);
});
