import { describe, expect, it } from "vitest";
import { emptyReport } from "../src/opencode/events.js";
import type { RunResult } from "../src/opencode/runner.js";
import {
  formatTaskReport,
  groupErrors,
  relativizePaths,
  roleModelsHint,
  taskStatus,
} from "../src/tools/task.js";

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    ...emptyReport(),
    model: "litellm/gpt-oss-120b",
    sessionId: "ses_1",
    text: "done",
    finishReason: "stop",
    exitCode: 0,
    timedOut: false,
    durationMs: 1500,
    stderr: "",
    ...overrides,
  };
}

describe("taskStatus", () => {
  it("is completed when the junior stopped on its own, even after recovered errors", () => {
    expect(taskStatus(result({ errors: ["bash mkdir src: denied"] }))).toBe("completed");
  });

  it("reports timeouts, failures and unfinished runs", () => {
    expect(taskStatus(result({ timedOut: true, durationMs: 120000 }))).toMatch(
      /^TIMED OUT after 120s/,
    );
    expect(taskStatus(result({ exitCode: 1 }))).toBe("FAILED (exit code 1)");
    expect(taskStatus(result({ finishReason: "length" }))).toMatch(/without finishing.*length/);
  });
});

describe("groupErrors", () => {
  it("collapses repeated failures and caps the list", () => {
    expect(groupErrors(["a", "b", "a", "a", "c"], 2)).toEqual(["a ×3", "b", "… (1 more)"]);
  });
});

describe("formatTaskReport", () => {
  const git = {
    status: "?? src/a.js",
    diff: "diff --git a/src/a.js b/src/a.js\nnew file\n+++ b/src/a.js\n@@ new file @@\n+x",
  };

  it("brief: model, session, skills on one line, files, grouped errors and compact diff", () => {
    const report = formatTaskReport(
      result({
        skillsLoaded: ["rutas-y-alcance"],
        filesChanged: ["/p/src/a.js"],
        errors: ["bash mkdir src: denied", "bash mkdir src: denied"],
      }),
      git,
      ["estilo (global)"],
    );
    expect(report).toContain("## Junior task: completed");
    expect(report).toContain("litellm/gpt-oss-120b");
    expect(report).toContain("ses_1");
    expect(report).toContain("Skills given: estilo (global) · loaded itself: rutas-y-alcance");
    expect(report).toContain("- /p/src/a.js");
    expect(report).toContain("bash mkdir src: denied ×2");
    expect(report).toContain("=== src/a.js (new)\n@@ new file @@\n+x");
    expect(report).not.toContain("### git status");
    expect(report).not.toMatch(/\n\n\n/);
  });

  it("brief cuts long answers; full keeps them and adds git status", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    expect(formatTaskReport(result({ text }), git)).toContain("answer cut");
    const full = formatTaskReport(result({ text }), git, [], "full");
    expect(full).toContain("line 39");
    expect(full).toContain("### git status");
  });

  it("says when the project is not a git repository", () => {
    expect(formatTaskReport(result(), undefined)).toContain("not a git repository");
  });
});

describe("relativizePaths", () => {
  it("strips the project prefix from answer, files and errors", () => {
    const out = relativizePaths(
      result({
        text: "edité /p/src/a.js",
        filesChanged: ["/p/src/a.js", "/other/b.js"],
        errors: ["edit /p/x.js: denied"],
      }),
      "/p",
    );
    expect(out.text).toBe("edité src/a.js");
    expect(out.filesChanged).toEqual(["src/a.js", "/other/b.js"]);
    expect(out.errors).toEqual(["edit x.js: denied"]);
  });
});

describe("roleModelsHint", () => {
  it("is empty when no role model is configured", () => {
    expect(roleModelsHint({ code: undefined, plan: undefined, read: undefined })).toBe("");
  });

  it("lists only the configured roles", () => {
    const hint = roleModelsHint({ code: "p/coder", plan: undefined, read: "p/reader" });
    expect(hint).toContain("p/coder for writing/editing code");
    expect(hint).toContain("p/reader for searching");
    expect(hint).not.toContain("planning");
  });
});
