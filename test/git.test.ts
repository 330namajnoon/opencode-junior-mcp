import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compactDiff, gitSnapshot, onlyNewChanges } from "../src/git.js";

const diff = (path: string, body: string) =>
  `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n${body}`;

describe("compactDiff", () => {
  it("drops header noise and cuts per file and in total", () => {
    const long = ["@@ -1 +1 @@", ...Array.from({ length: 10 }, (_, i) => `+l${i}`)].join("\n");
    const out = compactDiff(`${diff("a.ts", long)}\n${diff("b.ts", long)}\n${diff("c.ts", long)}`, {
      perFile: 4,
      total: 6,
    });
    expect(out).not.toMatch(/^(index|---|\+\+\+)/m);
    expect(out).toContain("=== a.ts\n@@ -1 +1 @@\n+l0\n+l1\n+l2\n… (7 more lines)");
    expect(out).toContain("=== b.ts\n@@ -1 +1 @@\n+l0\n… (9 more lines)");
    expect(out).toContain("… (1 more files not shown)");
  });

  it("returns empty for no changes", () => {
    expect(compactDiff("", { perFile: 1, total: 1 })).toBe("");
  });
});

describe("onlyNewChanges", () => {
  it("keeps only files that are new or changed since before", () => {
    const before = `${diff("a.ts", "+old")}\n${diff("b.ts", "+same")}`;
    const after = `${diff("b.ts", "+same")}\n${diff("a.ts", "+newer")}\n${diff("c.ts", "+c")}`;
    const out = onlyNewChanges(before, after);
    expect(out).toContain("+newer");
    expect(out).toContain("+c");
    expect(out).not.toContain("+same");
  });
});

describe("gitSnapshot", () => {
  it("includes tracked changes and untracked files as new-file diffs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "junior-git-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
    git("init", "-q");
    writeFileSync(join(dir, "a.txt"), "one\n");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    writeFileSync(join(dir, "a.txt"), "two\n");
    writeFileSync(join(dir, "b.txt"), "new\n");
    const snap = await gitSnapshot(dir);
    expect(snap?.status).toContain("?? b.txt");
    expect(snap?.diff).toContain("+two");
    expect(snap?.diff).toContain("+++ b/b.txt\n@@ new file @@\n+new");
  });
});
