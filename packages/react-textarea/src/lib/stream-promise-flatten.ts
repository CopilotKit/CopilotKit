/**
 * Flatten a promise of a stream, into a stream.
 *
 * Useful because a stream already includes the notion of async value delivery,
 * so it often makes sense to simply await the values rather than the generator of the values.
 *
 * @param {Promise<ReadableStream<A>>} promise - The promise to flatten.
 * @returns {ReadableStream<A>} - The flattened stream.
 */

export function streamPromiseFlatten<A>(promise: Promise<ReadableStream<A>>): ReadableStream<A> {
  return new ReadableStream<A>({
    async start(controller) {
      try {
        const stream = await promise;
        const reader = stream.getReader();

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            return;
          }

          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
