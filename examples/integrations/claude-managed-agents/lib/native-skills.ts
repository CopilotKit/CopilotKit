import { createHash } from "node:crypto";
import type { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import {
  readArchive,
  validateSnapshot,
} from "@copilotkit/runtime/internal/learned-skills";
import { z } from "zod";

const skillReferenceSchema = z.object({
  type: z.enum(["custom", "anthropic"]),
  skill_id: z.string().min(1),
  version: z.string().min(1),
});
const baseAgentSchema = z.object({
  version: z.number().int().positive(),
  skills: z.array(skillReferenceSchema),
});
const sessionSchema = z
  .object({
    agent: z
      .object({
        id: z.string(),
        version: z.number().int().positive().optional(),
        skills: z.array(skillReferenceSchema).optional(),
        type: z.enum(["agent", "agent_with_overrides"]),
      })
      .passthrough(),
  })
  .passthrough();
const uploadSchema = z.object({
  id: z.string().min(1),
  latest_version_id: z.string().min(1),
});
type SkillReference = { type: "custom"; skill_id: string; version: string };

/** Only the public SDK operations needed to bridge native skill files. */
interface SkillsBridgeOptions {
  containerId: string;
  intelligence: Pick<CopilotKitIntelligence, "getLearnedSkillsSnapshot">;
  skills: {
    create(
      input: { files: File[]; display_name: string },
      options: { signal: AbortSignal; maxRetries: number },
    ): PromiseLike<unknown>;
  };
  agents: {
    retrieve(
      id: string,
      params: { version?: number },
      options: { signal: AbortSignal },
    ): PromiseLike<unknown>;
  };
  fetch?: typeof globalThis.fetch;
}

/** Stop waiting on cancellation without aborting an upload shared by other sessions. */
function waitForUpload<T>(upload: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    upload.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Attach published Intelligence Skill files when Managed Agents creates a session.
 * The adapter has no session-overrides hook in 0.0.1, so use Anthropic's public
 * fetch hook. All other requests pass through. Existing sessions keep their pin.
 * No agent resource is edited. A failed fetch, validation, or upload blocks creation.
 */
export function createSkillsFetch(
  options: SkillsBridgeOptions,
): typeof globalThis.fetch {
  const transport = options.fetch ?? globalThis.fetch;
  // Shared by concurrent session starts. Failed uploads are retryable on the next
  // start; successful IDs are scoped to this client/process, never another account.
  const uploads = new Map<string, Promise<SkillReference>>();
  return async (input, init) => {
    const request = new Request(input, init);
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/v1/sessions"
    )
      return transport(request);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(60_000),
    ]);
    signal.throwIfAborted();
    const body = sessionSchema.parse(await request.clone().json());
    const result = await options.intelligence.getLearnedSkillsSnapshot({
      containerId: options.containerId,
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    });
    if (result.status !== "snapshot")
      throw new Error("Intelligence did not return Skill files.");
    const snapshot = await validateSnapshot(result, signal);
    const baseAgent = baseAgentSchema.parse(
      await options.agents.retrieve(
        body.agent.id,
        { version: body.agent.version },
        { signal },
      ),
    );
    const baseSkills = body.agent.skills ?? baseAgent.skills;
    if (snapshot.skills.length + baseSkills.length > 500)
      throw new Error(
        "Managed Agents supports at most 500 skills per session.",
      );
    const archive = await readArchive(Buffer.from(result.bytes), signal);
    const skills: SkillReference[] = [];
    for (const skill of snapshot.skills) {
      signal.throwIfAborted();
      const digest = createHash("sha256")
        .update(
          JSON.stringify([
            options.containerId,
            skill.name,
            skill.files.map((file) => [file.path, file.sha256]),
          ]),
        )
        .digest("hex");
      let upload = uploads.get(digest);
      if (!upload) {
        const files = skill.files.map((file) => {
          const bytes = archive.get(`${skill.name}/${file.path}`);
          if (!bytes) throw new Error("A verified Skill file is missing.");
          return new File(
            [new Uint8Array(bytes)],
            `${skill.name}/${file.path}`,
            { type: "application/octet-stream" },
          );
        });
        // A shared upload has its own deadline: cancelling one waiting session
        // must not cancel a second session that needs the same files.
        upload = Promise.resolve(
          options.skills.create(
            { files, display_name: skill.name.slice(0, 255) },
            { signal: AbortSignal.timeout(30_000), maxRetries: 0 },
          ),
        )
          .then((value) => {
            const created = uploadSchema.parse(value);
            return {
              type: "custom" as const,
              skill_id: created.id,
              version: created.latest_version_id,
            };
          })
          .catch((error) => {
            uploads.delete(digest);
            throw error;
          });
        uploads.set(digest, upload);
        if (uploads.size > 1_000) uploads.delete(uploads.keys().next().value!);
      }
      skills.push(await waitForUpload(upload, signal));
    }
    signal.throwIfAborted();
    // Preserve native skills configured on the agent. Pin the same agent version
    // we just read so a concurrent Console edit cannot change this snapshot.
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return transport(
      new Request(request, {
        headers,
        body: JSON.stringify({
          ...body,
          agent: {
            ...body.agent,
            type: "agent_with_overrides",
            version: baseAgent.version,
            skills: [...baseSkills, ...skills],
          },
        }),
        signal,
      }),
    );
  };
}
