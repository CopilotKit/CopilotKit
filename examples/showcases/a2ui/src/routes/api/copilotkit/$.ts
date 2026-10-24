import { createFileRoute } from "@tanstack/react-router";
import { copilotKitHandler } from "../../../server/runtime";

const handle = ({ request }: { request: Request }) =>
  copilotKitHandler(request);

export const Route = createFileRoute("/api/copilotkit/$")({
  server: {
    handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle },
  },
});
