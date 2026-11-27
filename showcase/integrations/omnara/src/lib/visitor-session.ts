import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isDemoAgentId } from "./agents";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function sessionEnded() {
  return json({ error: "This chat session has ended. Start a new chat." }, 401);
}

export function createVisitorSessions() {
  // Match the replay lifetime of the runtime's in-memory runner.
  const key = randomBytes(32);
  const sign = (scope: string) =>
    createHmac("sha256", key).update(scope).digest();

  function read(request: Request) {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return;

    const token = authorization.slice(7);
    const [agentId, threadId, signature, extra] = token.split(".");
    if (
      !isDemoAgentId(agentId) ||
      !/^[a-f0-9-]{36}$/.test(threadId ?? "") ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature ?? "") ||
      extra !== undefined
    ) {
      return;
    }

    const expected = sign(`${agentId}.${threadId}`);
    if (timingSafeEqual(expected, Buffer.from(signature, "base64url"))) {
      return { agentId, threadId, token };
    }
  }

  function requireSession(request: Request) {
    const session = read(request);
    if (!session) throw sessionEnded();
    return session;
  }

  async function startOrResume(request: Request) {
    const body = await request.json().catch(() => null);
    const agentId: unknown = body?.agentId;
    if (!isDemoAgentId(agentId)) {
      return json({ error: "Select a valid Omnara demo." }, 400);
    }

    if (request.headers.has("authorization")) {
      const session = read(request);
      if (session?.agentId !== agentId) return sessionEnded();
      return json({ threadId: session.threadId, token: session.token });
    }

    // A public demo uses one thread and one Omnara identity per browser session.
    const threadId = randomUUID();
    const scope = `${agentId}.${threadId}`;
    const token = `${scope}.${sign(scope).toString("base64url")}`;
    return json({ threadId, token });
  }

  return { requireSession, startOrResume };
}
