export const isLocalhost = (url: string): boolean => {
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("0.0.0.0")
  );
};
