// Empty PostCSS config so Vite (used by mcp-use to bundle widgets) doesn't
// walk up to the workspace root and pick up the Next.js Tailwind v3-style
// PostCSS config — Tailwind v4 in widgets is wired via @tailwindcss/vite.
export default { plugins: [] };
