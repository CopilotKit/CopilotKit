"use client";

import dynamic from "next/dynamic";

/**
 * The early-access landing page (`./channel-landing`) in a client bundle of
 * its own. One catch-all route renders every docs page, and each page loads
 * every client component that route imports, so a static import would ship
 * the four pages' words and the demo booker to all of them. Next splits a
 * client component's dynamic import (not a server component's), so this
 * loader is the client component that imports it. The page still renders on
 * the server, which preloads its chunk, so nothing changes on screen while it
 * hydrates.
 */
export const ChannelLandingLoader = dynamic(() =>
  import("./channel-landing").then((m) => m.ChannelLanding),
);
