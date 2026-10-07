/**
 * Reading and writing of the junior's skills: `<dir>/<name>/SKILL.md` files with
 * a YAML frontmatter holding `name` and `description`, as opencode expects.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SkillScope = "global" | "project";

export interface SkillSummary {
  name: string;
  description: string;
  scope: SkillScope;
  path: string;
}

export interface Skill extends SkillSummary {
  /** Markdown body without the frontmatter. */
  body: string;
}

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SKILL_FILE = "SKILL.md";

/** opencode reads project skills from either folder name. */
const PROJECT_SKILL_DIRS = [".opencode/skills", ".opencode/skill"];

export function projectSkillsDir(cwd: string): string {
  return join(cwd, PROJECT_SKILL_DIRS[0]!);
}

export function parseSkill(raw: string): { name?: string; description?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { body: raw };
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]!] = unquote(field[2]!.trim());
  }
  return { name: fields.name, description: fields.description, body: match[2]!.trim() };
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

export function renderSkill(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`;
}

export function validateSkill(name: string, description: string): void {
  if (!SKILL_NAME_PATTERN.test(name) || name.length > 64) {
    throw new Error(
      `Invalid skill name "${name}": use 1-64 lowercase letters, digits and single hyphens (kebab-case).`,
    );
  }
  if (!description.trim() || description.length > 1024) {
    throw new Error("Skill description must be between 1 and 1024 characters.");
  }
  if (/[\r\n]/.test(description)) {
    throw new Error("Skill description must be a single line.");
  }
}

async function listDir(dir: string, scope: SkillScope): Promise<SkillSummary[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: SkillSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, SKILL_FILE);
    try {
      const parsed = parseSkill(await readFile(path, "utf8"));
      skills.push({
        name: parsed.name ?? entry.name,
        description: parsed.description ?? "",
        scope,
        path,
      });
    } catch {
      // Folder without SKILL.md: not a skill.
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export class SkillStore {
  constructor(private readonly globalDir: string) {}

  private dirsFor(cwd: string | undefined): Array<[string, SkillScope]> {
    const dirs: Array<[string, SkillScope]> = [];
    if (cwd) for (const dir of PROJECT_SKILL_DIRS) dirs.push([join(cwd, dir), "project"]);
    dirs.push([this.globalDir, "global"]);
    return dirs;
  }

  /** Lists project skills (when `cwd` is given) and global skills. */
  async list(cwd?: string): Promise<SkillSummary[]> {
    const groups = await Promise.all(this.dirsFor(cwd).map(([dir, scope]) => listDir(dir, scope)));
    return groups.flat();
  }

  /** Reads a skill by name; project skills take precedence over global ones. */
  async read(name: string, cwd?: string): Promise<Skill | undefined> {
    for (const [dir, scope] of this.dirsFor(cwd)) {
      const path = join(dir, name, SKILL_FILE);
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        continue;
      }
      const parsed = parseSkill(raw);
      return {
        name: parsed.name ?? name,
        description: parsed.description ?? "",
        body: parsed.body,
        scope,
        path,
      };
    }
    return undefined;
  }

  /** Reads every skill that applies to `cwd`; a project skill hides a global one with the same name. */
  async readAll(cwd?: string): Promise<Skill[]> {
    const skills: Skill[] = [];
    const seen = new Set<string>();
    for (const summary of await this.list(cwd)) {
      if (seen.has(summary.name)) continue;
      seen.add(summary.name);
      const raw = await readFile(summary.path, "utf8");
      skills.push({ ...summary, body: parseSkill(raw).body });
    }
    return skills;
  }

  /** Creates or replaces a skill and returns its path and whether it already existed. */
  async write(params: {
    name: string;
    description: string;
    body: string;
    scope: SkillScope;
    cwd?: string;
  }): Promise<{ path: string; created: boolean }> {
    const { name, description, body, scope, cwd } = params;
    validateSkill(name, description);
    if (scope === "project" && !cwd) {
      throw new Error("A project skill needs `cwd` (absolute path of the project).");
    }
    const baseDir = scope === "project" ? projectSkillsDir(cwd!) : this.globalDir;
    const dir = join(baseDir, name);
    const path = join(dir, SKILL_FILE);
    const existed = await readFile(path, "utf8").then(
      () => true,
      () => false,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(path, renderSkill(name, description, body), "utf8");
    return { path, created: !existed };
  }
}
