import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSkill, renderSkill, SkillStore } from "../src/skills/store.js";

let root: string;
let globalDir: string;
let project: string;
let store: SkillStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "junior-skills-"));
  globalDir = join(root, "global");
  project = join(root, "project");
  await mkdir(project);
  store = new SkillStore(globalDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parseSkill / renderSkill", () => {
  it("round-trips name, description and body", () => {
    const raw = renderSkill("my-skill", 'Use when "quoted": yes', "# Body\n\n- rule");
    expect(parseSkill(raw)).toEqual({
      name: "my-skill",
      description: 'Use when "quoted": yes',
      body: "# Body\n\n- rule",
    });
  });

  it("reads unquoted frontmatter written by hand", () => {
    const parsed = parseSkill("---\nname: a\ndescription: Plain text: with colon\n---\nbody");
    expect(parsed).toEqual({ name: "a", description: "Plain text: with colon", body: "body" });
  });

  it("treats a file without frontmatter as body only", () => {
    expect(parseSkill("just text")).toEqual({ body: "just text" });
  });
});

describe("SkillStore", () => {
  it("writes, lists and reads a global skill", async () => {
    const first = await store.write({
      name: "paths",
      description: "When writing files.",
      body: "- rule",
      scope: "global",
    });
    expect(first.created).toBe(true);
    const second = await store.write({
      name: "paths",
      description: "When writing files.",
      body: "- rule 2",
      scope: "global",
    });
    expect(second.created).toBe(false);

    expect(await store.list()).toEqual([
      { name: "paths", description: "When writing files.", scope: "global", path: first.path },
    ]);
    const skill = await store.read("paths");
    expect(skill?.body).toBe("- rule 2");
  });

  it("gives project skills precedence and lists both scopes", async () => {
    await store.write({
      name: "style",
      description: "Global style.",
      body: "global",
      scope: "global",
    });
    await store.write({
      name: "style",
      description: "Project style.",
      body: "project",
      scope: "project",
      cwd: project,
    });

    expect((await store.read("style", project))?.body).toBe("project");
    expect((await store.read("style"))?.body).toBe("global");
    expect((await store.list(project)).map((s) => s.scope)).toEqual(["project", "global"]);
  });

  it("reads all applicable skills, with project ones hiding global ones", async () => {
    await store.write({ name: "style", description: "G.", body: "global", scope: "global" });
    await store.write({ name: "other", description: "O.", body: "other", scope: "global" });
    await store.write({
      name: "style",
      description: "P.",
      body: "project",
      scope: "project",
      cwd: project,
    });
    const all = await store.readAll(project);
    expect(all.map((s) => [s.name, s.body])).toEqual([
      ["style", "project"],
      ["other", "other"],
    ]);
  });

  it("also finds project skills in the singular .opencode/skill folder", async () => {
    const dir = join(project, ".opencode", "skill", "legacy");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: legacy\ndescription: Old folder.\n---\nbody",
    );
    expect((await store.list(project)).map((s) => s.name)).toEqual(["legacy"]);
  });

  it("ignores folders without SKILL.md and missing directories", async () => {
    await mkdir(join(globalDir, "empty"), { recursive: true });
    expect(await store.list(join(root, "missing"))).toEqual([]);
  });

  it("validates names, descriptions and project cwd", async () => {
    await expect(
      store.write({ name: "Bad Name", description: "x", body: "b", scope: "global" }),
    ).rejects.toThrow(/Invalid skill name/);
    await expect(
      store.write({ name: "ok", description: "two\nlines", body: "b", scope: "global" }),
    ).rejects.toThrow(/single line/);
    await expect(
      store.write({ name: "ok", description: "x", body: "b", scope: "project" }),
    ).rejects.toThrow(/needs `cwd`/);
  });

  it("writes a frontmatter opencode can read", async () => {
    const { path } = await store.write({
      name: "fmt",
      description: "Desc: with colon.",
      body: "b",
      scope: "global",
    });
    expect(await readFile(path, "utf8")).toBe(
      '---\nname: fmt\ndescription: "Desc: with colon."\n---\n\nb\n',
    );
  });
});
