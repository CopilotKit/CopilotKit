import { sveltekit } from "@sveltejs/kit/vite";

export default {
  plugins: [sveltekit()],
  ssr: {
    noExternal: ["@copilotkit/svelte"],
  },
};
