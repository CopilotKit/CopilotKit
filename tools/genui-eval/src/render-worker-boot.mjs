// Starts the render worker with tsx's loader, which resolves the extensionless
// and directory imports of react-core's source (a plain --import does not
// inside a worker thread).
import { tsImport } from "tsx/esm/api";

await tsImport("./render-worker.ts", import.meta.url);
