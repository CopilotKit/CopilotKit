// The release line that this build of the docs serves, set at build time.
//
// DOCS_CHANNEL=vnext builds the docs of the next major release (the 2.0
// release candidate) as a site of its own: every page shows a banner that
// points to the current docs, and the site asks search engines not to index
// it. Without the variable, the build is docs.copilotkit.ai, unchanged.
//
// next.config.mjs inlines DOCS_CHANNEL when the app builds, so the server, the
// client, and the prerendered robots.txt all read the build's value. Railway
// gives a Dockerfile build its service variables only as build args, so the
// Dockerfile declares DOCS_CHANNEL as one.

/** Whether this build serves the docs of the next major release. */
export const isVnextChannel =
  process.env.DOCS_CHANNEL?.trim().toLowerCase() === "vnext";
