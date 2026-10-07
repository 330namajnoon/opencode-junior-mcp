import type { Skill } from "../skills/store.js";

/**
 * Builds the message sent to the junior. Skills are injected into the message
 * instead of relying on the junior to load them: small models often skip the
 * `skill` tool (and even claim they loaded skills they never read).
 */
export function buildPrompt(instructions: string, skills: Skill[]): string {
  if (!skills.length) return instructions;
  const lessons = skills
    .map((skill) =>
      [`## Skill: ${skill.name}`, `_${skill.description}_`, "", skill.body].join("\n"),
    )
    .join("\n\n");
  return [
    "# Lecciones del senior (obligatorias en todos los encargos)",
    "Estas skills ya estan cargadas aqui; no hace falta que las cargues con la herramienta skill.",
    "",
    lessons,
    "",
    "---",
    "",
    "# Encargo",
    "",
    instructions,
  ].join("\n");
}
