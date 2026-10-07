import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/opencode/prompt.js";
import type { Skill } from "../src/skills/store.js";

const skill: Skill = {
  name: "paths",
  description: "When writing files.",
  body: "- Use absolute paths.",
  scope: "global",
  path: "/x/paths/SKILL.md",
};

describe("buildPrompt", () => {
  it("returns the instructions unchanged when there are no skills", () => {
    expect(buildPrompt("do it", [])).toBe("do it");
  });

  it("puts the skills before the task", () => {
    const prompt = buildPrompt("do it", [skill]);
    expect(prompt).toContain("## Skill: paths");
    expect(prompt).toContain("- Use absolute paths.");
    expect(prompt.indexOf("## Skill: paths")).toBeLessThan(prompt.indexOf("# Encargo"));
    expect(prompt.endsWith("do it")).toBe(true);
  });
});
