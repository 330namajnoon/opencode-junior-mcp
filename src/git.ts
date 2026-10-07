import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trimEnd();
  } catch {
    return undefined;
  }
}

export interface GitSnapshot {
  /** `git status --short` output (listing each untracked file), empty when the tree is clean. */
  status: string;
  /** `git diff HEAD` of tracked files plus untracked files shown as new files. */
  diff: string;
}

const MAX_UNTRACKED_BYTES = 200 * 1024;

/** Untracked text files rendered as "new file" diffs; binary or large files are only named. */
async function untrackedDiff(cwd: string, status: string): Promise<string> {
  const paths = status
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  const parts: string[] = [];
  for (const path of paths) {
    const header = `diff --git a/${path} b/${path}\nnew file\n+++ b/${path}`;
    try {
      const file = join(cwd, path);
      if ((await stat(file)).size > MAX_UNTRACKED_BYTES) {
        parts.push(`${header}\n(large file, not shown)`);
        continue;
      }
      const content = await readFile(file, "utf8");
      if (content.includes("\0")) {
        parts.push(`${header}\n(binary file, not shown)`);
        continue;
      }
      const lines = content.replace(/\n$/, "").split("\n");
      parts.push(`${header}\n@@ new file @@\n${lines.map((line) => `+${line}`).join("\n")}`);
    } catch {
      parts.push(`${header}\n(could not read)`);
    }
  }
  return parts.join("\n");
}

/** Read-only snapshot of the working tree, or undefined if `cwd` is not a git repo. */
export async function gitSnapshot(cwd: string): Promise<GitSnapshot | undefined> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return undefined;
  // --relative keeps paths relative to cwd, matching `status`, when cwd is a subfolder.
  const [status, tracked] = await Promise.all([
    git(cwd, ["status", "--short", "--untracked-files=all", "--", "."]),
    git(cwd, ["diff", "HEAD", "--relative", "--no-color", "--no-ext-diff"]),
  ]);
  const untracked = await untrackedDiff(cwd, status ?? "");
  return { status: status ?? "", diff: [tracked, untracked].filter(Boolean).join("\n") };
}

export interface DiffLimits {
  /** Max lines of hunk content shown per file. */
  perFile: number;
  /** Max lines of hunk content shown in total. */
  total: number;
}

/**
 * Shrinks a unified diff for review: drops `index`/`---` noise, keeps one `+++` header per file
 * and cuts each file (and the whole diff) after a number of lines, saying how many were left out.
 */
export function compactDiff(diff: string, limits: DiffLimits): string {
  if (!diff.trim()) return "";
  const files = diff.split(/^(?=diff --git )/m).filter((chunk) => chunk.trim());
  const out: string[] = [];
  let budget = limits.total;
  let hiddenFiles = 0;

  for (const file of files) {
    const lines = file.replace(/\n$/, "").split("\n");
    const name =
      lines.find((line) => line.startsWith("+++ "))?.replace(/^\+\+\+ (b\/)?/, "") ??
      (lines[0] ?? "").replace(/^diff --git a\/\S+ b\//, "");
    const body = lines.filter(
      (line) =>
        !/^(diff --git |index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode)/.test(
          line,
        ),
    );
    if (budget <= 0) {
      hiddenFiles++;
      continue;
    }
    const deleted = lines.some((line) => line.startsWith("deleted file"));
    const isNew = lines.some((line) => line.startsWith("new file"));
    out.push(`=== ${name}${deleted ? " (deleted)" : isNew ? " (new)" : ""}`);
    if (deleted) continue;
    const shown = body.slice(0, Math.min(limits.perFile, budget));
    out.push(...shown);
    budget -= shown.length;
    if (body.length > shown.length) out.push(`… (${body.length - shown.length} more lines)`);
  }
  if (hiddenFiles) out.push(`… (${hiddenFiles} more files not shown)`);
  return out.join("\n");
}

function splitByFile(diff: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    const path = /^diff --git a\/(\S+)/.exec(chunk)?.[1];
    // trimEnd: the last file has no trailing newline, so the same file can differ only by that.
    if (path) files.set(path, chunk.trimEnd());
  }
  return files;
}

/** Keeps the file sections of `after` that did not exist, or were different, in `before`. */
export function onlyNewChanges(before: string, after: string): string {
  const old = splitByFile(before);
  return [...splitByFile(after)]
    .filter(([path, chunk]) => old.get(path) !== chunk)
    .map(([, chunk]) => chunk)
    .join("\n");
}
