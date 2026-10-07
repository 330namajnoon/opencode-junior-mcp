import { isAbsolute } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SKILL_NAME_PATTERN, type SkillStore } from "../skills/store.js";

const absolutePath = z.string().refine(isAbsolute, "must be an absolute path");

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], isError };
}

export function registerSkillTools(server: McpServer, store: SkillStore): void {
  server.registerTool(
    "junior_list_skills",
    {
      title: "List the junior's skills",
      description:
        "Lists the skills (lessons) the junior has: global ones and, when `cwd` is given, the project's own. " +
        "Check this before teaching something new, to extend an existing skill instead of duplicating it.",
      inputSchema: {
        cwd: absolutePath.optional().describe("Project path, to include its project-level skills."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cwd }) => {
      const skills = await store.list(cwd);
      if (!skills.length) return text("The junior has no skills yet.");
      const lines = skills.map(
        (s) => `- **${s.name}** (${s.scope}): ${s.description || "(no description)"}`,
      );
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "junior_read_skill",
    {
      title: "Read one of the junior's skills",
      description:
        "Returns the full content of a skill. Project skills take precedence over global ones with the same name.",
      inputSchema: {
        name: z.string().describe("Skill name (kebab-case)."),
        cwd: absolutePath
          .optional()
          .describe("Project path, to look in its project-level skills first."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name, cwd }) => {
      const skill = await store.read(name, cwd);
      if (!skill) return text(`Skill "${name}" not found.`, true);
      return text(
        [
          `# ${skill.name} (${skill.scope})`,
          `Path: ${skill.path}`,
          `Description: ${skill.description}`,
          "",
          skill.body,
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "junior_write_skill",
    {
      title: "Teach the junior (create or update a skill)",
      description:
        "Creates or replaces a skill: a lesson that is included in the prompt of every new junior_task. " +
        "Use it when the junior makes a mistake that could happen again (project conventions, bad habits, tool misuse). " +
        "Keep one topic per skill; to extend an existing one, read it first and send the full new body. " +
        "Make the description concrete about WHEN it applies, so the junior knows when to follow it. " +
        "Body: short imperative rules, the lesson learned in one line, and a correct vs wrong example if useful.",
      inputSchema: {
        name: z
          .string()
          .regex(SKILL_NAME_PATTERN, "use kebab-case")
          .max(64)
          .describe("Skill name in kebab-case, e.g. `symfony-controllers`."),
        description: z
          .string()
          .min(1)
          .max(1024)
          .describe(
            "One line saying when the skill applies, e.g. 'Apply ALWAYS when editing PHP files in a Symfony project.'",
          ),
        body: z.string().min(1).describe("Markdown content of the skill (without frontmatter)."),
        scope: z
          .enum(["global", "project"])
          .default("global")
          .describe(
            "`global` for every project, `project` for lessons that only apply to one repository.",
          ),
        cwd: absolutePath.optional().describe("Project path. Required when scope is `project`."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, description, body, scope, cwd }) => {
      try {
        const { path, created } = await store.write({ name, description, body, scope, cwd });
        return text(`${created ? "Created" : "Updated"} ${scope} skill "${name}" at ${path}.`);
      } catch (error) {
        return text((error as Error).message, true);
      }
    },
  );
}
