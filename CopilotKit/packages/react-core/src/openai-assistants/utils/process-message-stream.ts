export async function processMessageStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  processMessage: (message: string) => void | Promise<void>,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      if (buffer.length > 0) {
        processMessage(buffer);
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let endIndex: number;
    while ((endIndex = buffer.indexOf("\n")) !== -1) {
      processMessage(buffer.substring(0, endIndex).trim());
      buffer = buffer.substring(endIndex + 1); // Remove the processed instruction + delimiter
    }
  }
}
