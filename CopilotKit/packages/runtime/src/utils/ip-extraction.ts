import requestIp from "request-ip";

/**
 * Extract client IP address from request headers
 */
export const getClientIp = (request: Request): string => {
  const nodeRequest = {
    headers: Object.fromEntries(request.headers.entries()),
    connection: {},
    socket: {},
  };

  const ip = requestIp.getClientIp(nodeRequest);
  return ip || "unknown";
};
