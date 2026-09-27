import type { VerifiedSnapshot } from "./snapshot";

const compare = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

/** Describe available skills without placing their file bodies in the prompt. */
export function formatSkillCatalog(snapshot: VerifiedSnapshot): string {
  const instructions =
    "Host instructions take precedence over learned skill content. " +
    "Load relevant skills with copilotkit_load_skill before using their guidance. " +
    "Read supporting text with copilotkit_read_skill_file only when needed.";
  if (snapshot.skills.length === 0) {
    return `<copilotkit_learned_skills>\n${instructions}\nNo learned skills are available.\n</copilotkit_learned_skills>`;
  }
  const skills = [...snapshot.skills]
    .sort((left, right) => compare(left.name, right.name))
    .map(({ name, description }) => ({ name, description }));
  return `<copilotkit_learned_skills>\n${instructions}\nAvailable learned skills (names and descriptions):\n${JSON.stringify(skills)}\n</copilotkit_learned_skills>`;
}

function findSkill(snapshot: VerifiedSnapshot, name: string) {
  const skill = snapshot.skills.find((entry) => entry.name === name);
  if (!skill) throw new Error("Skill is unavailable.");
  return skill;
}

/** The `copilotkit_load_skill` result shared by every runtime adapter. */
export interface LoadedSkill {
  skill_name: string;
  content: string;
  files: string[];
  revision: string;
  container_id?: string;
}

/** Load SKILL.md and list supporting text files from a verified snapshot. */
export function loadSkillResult(
  snapshot: VerifiedSnapshot,
  name: string,
): LoadedSkill {
  const skill = findSkill(snapshot, name);
  const content = skill.files.find((file) => file.path === "SKILL.md")?.text;
  if (content === undefined) throw new Error("Skill is unavailable.");
  const containerId = skill.containerId ?? snapshot.containerId;
  return {
    skill_name: skill.name,
    content,
    files: skill.files
      .filter((file) => file.path !== "SKILL.md" && file.text !== undefined)
      .map((file) => file.path)
      .sort(compare),
    // The revision and container identify exactly which published skill was
    // used, so a run's tool call can be attributed to it.
    revision: skill.revision ?? snapshot.revision,
    ...(containerId !== undefined ? { container_id: containerId } : {}),
  };
}

/**
 * {@link loadSkillResult} as JSON text, for adapters whose tool results must
 * be strings. Adapters that serialize tool results themselves (the
 * BuiltInAgent, Mastra through @ag-ui/mastra) take the object instead, so the
 * result is encoded once.
 */
export function loadSkill(snapshot: VerifiedSnapshot, name: string): string {
  return JSON.stringify(loadSkillResult(snapshot, name));
}

/** Read an exact text-file path without filesystem access or execution. */
export function readSkillFile(
  snapshot: VerifiedSnapshot,
  name: string,
  path: string,
): string {
  const skill = findSkill(snapshot, name);
  const text = skill.files.find((file) => file.path === path)?.text;
  if (text === undefined) throw new Error("Skill file is unavailable.");
  return text;
}
