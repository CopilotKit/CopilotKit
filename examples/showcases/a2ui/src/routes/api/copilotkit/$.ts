import { createFileRoute } from "@tanstack/react-router";
import {
  signedOutHandler,
  readerHandler,
  readerId,
} from "../../../server/runtime";

// A signed-in reader gets Intelligence (threads kept, apps connected);
// signed out, the default, gets the same agent with nothing kept. The browser remounts its
// CopilotKit provider when the reader signs in or out, so it always talks to
// the runtime that matches.
const handle = async ({ request }: { request: Request }) =>
  (await readerId()) ? readerHandler(request) : signedOutHandler(request);

export const Route = createFileRoute("/api/copilotkit/$")({
  server: {
    handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle },
  },
});
