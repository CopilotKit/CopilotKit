import { redirect } from "next/navigation";

// The skill builder became the Get started page's copy-prompt flow; old links land there.
export default function SkillsPage() {
  redirect("/start");
}
