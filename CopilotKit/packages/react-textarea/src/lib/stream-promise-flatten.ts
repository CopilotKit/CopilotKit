export function streamPromiseFlatten<A>(
  promise: Promise<ReadableStream<A>>
): ReadableStream<A> {
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
