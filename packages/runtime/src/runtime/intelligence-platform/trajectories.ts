import { logger } from "@copilotkit/shared";
import { z } from "zod";

export interface TrajectoryConnectionGrant {
  joinToken: string;
  realtime: { clientUrl: string; topic: string };
}

const trajectoryIdSchema = z.string().uuid();

export function isValidTrajectoryId(value: unknown): value is string {
  return trajectoryIdSchema.safeParse(value).success;
}

const joinResponseSchema = z.object({
  joinToken: z.string().refine((value) => value.trim().length > 0),
  trajectoryId: trajectoryIdSchema,
});

const grantSchema = z.object({
  joinToken: z.string().refine((value) => value.trim().length > 0),
  realtime: z.object({
    clientUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          (url.protocol === "wss:" || url.protocol === "ws:") &&
          !url.username &&
          !url.password
        );
      }),
    topic: z
      .string()
      .refine((value) => value.trim().length > 0 && !/\p{Cc}/u.test(value)),
  }),
});

const runtimeConfigurationErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "AUTH_UNAUTHENTICATED",
      "API_KEY_NOT_FOUND",
      "ORG_NOT_FOUND",
      "PROJECT_NOT_FOUND",
    ]),
  }),
});

const contractErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "VALIDATION_ERROR",
      "TRAJECTORY_APP_USER_CONFLICT",
      "LEARNING_CONTAINER_NOT_FOUND",
      "RATE_LIMIT_EXCEEDED",
      "INTERNAL_SERVER_ERROR",
      "MARKETPLACE_LICENSE_REQUIRED",
      "TRAJECTORIES_NOT_ENABLED",
    ]),
    message: z.string().trim().min(1).max(512),
  }),
});

export class TrajectoryConnectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TrajectoryConnectionError";
  }
}

export function parseTrajectoryConnectionGrant(
  value: unknown,
  trajectoryId: string,
  clientUrl: string,
): TrajectoryConnectionGrant {
  const join = joinResponseSchema.safeParse(value);
  const result = grantSchema.safeParse(
    join.success && join.data.trajectoryId === trajectoryId
      ? {
          joinToken: join.data.joinToken,
          realtime: { clientUrl, topic: `trajectory:${trajectoryId}` },
        }
      : undefined,
  );
  if (!result.success) {
    const joinValid = join.success && join.data.trajectoryId === trajectoryId;
    logger.warn(
      { trajectoryIdMatches: joinValid },
      joinValid
        ? "Intelligence returned a Trajectory join token, but the Gateway URL is invalid; check the Intelligence wsUrl"
        : "Intelligence returned an invalid Trajectory join response",
    );
    throw new TrajectoryConnectionError(
      "CONNECTION_FAILED",
      "Intelligence returned an invalid trajectory connection grant",
      502,
    );
  }
  return {
    joinToken: result.data.joinToken,
    realtime: {
      clientUrl: result.data.realtime.clientUrl,
      topic: result.data.realtime.topic,
    },
  };
}

// Intelligence answers with this code when Trajectory capture is switched off
// for the deployment, because the join route is then not registered.
const routeNotFoundSchema = z.object({
  error: z.object({ code: z.literal("ROUTE_NOT_FOUND") }),
});

const upstreamCodeSchema = z.object({
  error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/) }),
});

/** Forward only the public contract, never raw platform errors or credentials. */
export function trajectoryResponseError(
  value: unknown,
  status: number,
  apiKey: string,
): TrajectoryConnectionError {
  const result = contractErrorSchema.safeParse(value);
  if (result.success && !result.data.error.message.includes(apiKey)) {
    return new TrajectoryConnectionError(
      result.data.error.code,
      result.data.error.message,
      status,
    );
  }
  if (status === 404 && routeNotFoundSchema.safeParse(value).success) {
    logger.warn(
      { status },
      "Intelligence does not serve Trajectory capture; enable Trajectories for this deployment",
    );
    return new TrajectoryConnectionError(
      "TRAJECTORIES_UNAVAILABLE",
      "This Intelligence deployment does not serve Trajectory capture",
      404,
    );
  }
  // The browser only learns that the connection failed. Log the upstream code,
  // never the message, so the cause is visible to the Runtime's operator.
  logger.warn(
    {
      status,
      upstreamCode: upstreamCodeSchema.safeParse(value).data?.error.code,
    },
    "Intelligence rejected the Trajectory connection request; the browser receives CONNECTION_FAILED",
  );
  // These failures describe the Runtime's server credentials or tenant setup,
  // not the browser user's identity. Do not expose them as a client auth error.
  if (runtimeConfigurationErrorSchema.safeParse(value).success) {
    return new TrajectoryConnectionError(
      "CONNECTION_FAILED",
      "Could not connect to Intelligence",
      502,
    );
  }
  return new TrajectoryConnectionError(
    "CONNECTION_FAILED",
    "Intelligence rejected the trajectory connection request",
    status,
  );
}
