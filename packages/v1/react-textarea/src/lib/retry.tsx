export function retry<T>(
  fn: () => Promise<T>,
  retriesLeft: number = 2,
  interval: number = 200,
  backoff: number = 1.5,
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn()
      .then(resolve)
      .catch((error) => {
        if (retriesLeft === 1) {
          reject(error);
          return;
        }

        setTimeout(() => {
          retry(fn, retriesLeft - 1, interval * backoff, backoff)
            .then(resolve)
            .catch(reject);
        }, interval);
      });
  });
}
