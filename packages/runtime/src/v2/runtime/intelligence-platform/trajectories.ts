import { z } from "zod";

export interface TrajectoryConnectionGrant {
  joinToken: string;
  realtime: { clientUrl: string; topic: string };
}

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
      .refine(
        (value) =>
          value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value),
      ),
  }),
});

const contractErrorSchema = z.object({
  code: z.enum([
    "IDENTITY_REQUIRED",
    "FORBIDDEN",
    "TOKEN_INVALID",
    "INVALID_REQUEST",
    "NOT_FOUND",
    "RATE_LIMITED",
    "CONNECTION_FAILED",
  ]),
  message: z.string().trim().min(1).max(512),
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
): TrajectoryConnectionGrant {
  const result = grantSchema.safeParse(value);
  if (!result.success) {
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

/** Forward only the public contract, never raw platform errors or credentials. */
export function trajectoryResponseError(
  value: unknown,
  status: number,
  apiKey: string,
): TrajectoryConnectionError {
  const result = contractErrorSchema.safeParse(value);
  if (result.success && !result.data.message.includes(apiKey)) {
    return new TrajectoryConnectionError(
      result.data.code,
      result.data.message,
      status,
    );
  }
  return new TrajectoryConnectionError(
    "CONNECTION_FAILED",
    "Intelligence rejected the trajectory connection request",
    status,
  );
}
