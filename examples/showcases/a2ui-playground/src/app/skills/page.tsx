import { redirect } from "next/navigation";

// The skill builder became the Get started page's copy-prompt flow; old links land there, in the theme
// they asked for (`?theme=`, how a dark page embeds or links the site).
export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { theme } = await searchParams;
  redirect(
    theme === "dark" || theme === "light" ? `/start?theme=${theme}` : "/start",
  );
}
