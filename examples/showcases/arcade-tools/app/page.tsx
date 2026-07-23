import { HomeClient } from "./home-client";

// Read runtime env per request so the "add your keys" hint reflects reality
// (env isn't available at build time, and these are server-only, so only the
// boolean crosses to the client, never the keys themselves).
export const dynamic = "force-dynamic";

export default function Home() {
  const keysConfigured = Boolean(
    process.env.ARCADE_API_KEY && process.env.OPENAI_API_KEY,
  );
  return <HomeClient keysConfigured={keysConfigured} />;
}
