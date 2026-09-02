import { expect, test } from "vitest";
import { getOrLoadResource } from "./resource-cache";

function createDeferred<T>() {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) {
        throw new Error("Deferred promise is not initialized");
      }
      resolvePromise(value);
    },
    reject(reason: unknown) {
      if (!rejectPromise) {
        throw new Error("Deferred promise is not initialized");
      }
      rejectPromise(reason);
    },
  };
}

test("shares one in-flight load between concurrent callers", async () => {
  const resourceUrl = "https://example.com/concurrent-resource";
  const deferred = createDeferred<string>();
  let loaderCalls = 0;
  const load = () => {
    loaderCalls += 1;
    return deferred.promise;
  };

  const first = getOrLoadResource(resourceUrl, load);
  const second = getOrLoadResource(resourceUrl, load);

  expect(loaderCalls).toBe(1);
  deferred.resolve("Shared resource");
  await expect(Promise.all([first, second])).resolves.toEqual([
    "Shared resource",
    "Shared resource",
  ]);
});

test("clears a rejected shared load so the next caller retries", async () => {
  const resourceUrl = "https://example.com/rejected-concurrent-resource";
  const deferred = createDeferred<string>();
  const failure = new Error("Temporary network failure");
  let loaderCalls = 0;
  const load = () => {
    loaderCalls += 1;
    return loaderCalls === 1
      ? deferred.promise
      : Promise.resolve("Recovered resource");
  };

  const first = getOrLoadResource(resourceUrl, load);
  const second = getOrLoadResource(resourceUrl, load);

  expect(loaderCalls).toBe(1);
  const currentCallers = Promise.all([
    expect(first).rejects.toBe(failure),
    expect(second).rejects.toBe(failure),
  ]);
  deferred.reject(failure);
  await currentCallers;

  await expect(getOrLoadResource(resourceUrl, load)).resolves.toBe(
    "Recovered resource",
  );
  expect(loaderCalls).toBe(2);
});

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
