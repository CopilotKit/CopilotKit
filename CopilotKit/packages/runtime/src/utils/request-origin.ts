import ip from "ip";

/**
 * Determines if an IP address is a loopback address
 */
const isLocalAddress = (address: string): boolean => {
  return address === "127.0.0.1" || address === "::1";
};

/**
 * Extracts the originating network address from HTTP request headers
 * following standard proxy forwarding conventions
 */
export const getRequestOrigin = (request: Request): string => {
  // Check standard forwarded headers in order of preference
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const originAddress = forwardedFor.split(",")[0].trim();
    if (!isLocalAddress(originAddress)) {
      return originAddress;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp && !isLocalAddress(realIp)) {
    return realIp;
  }

  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp && !isLocalAddress(cfConnectingIp)) {
    return cfConnectingIp;
  }

  // Fallback to local network interface
  try {
    const networkAddress = ip.address();
    if (networkAddress && !isLocalAddress(networkAddress)) {
      return networkAddress;
    }
  } catch (error) {
    // Network interface unavailable
  }

  return "unknown";
};
