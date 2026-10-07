import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface CheckResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  output: string;
}

/** npm scripts run by default, in this order, when the project defines them. */
const DEFAULT_SCRIPTS = ["typecheck", "lint", "test"];
const MAX_OUTPUT = 2 * 1024 * 1024;
const ERROR_LINE =
  /error|fail|✗|✖|×|assert|expected|received|exception|traceback|cannot|unexpected|not found/i;

/** Default checks from package.json scripts, or an empty list if there is nothing to run. */
export async function detectChecks(cwd: string): Promise<string[]> {
  try {
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return DEFAULT_SCRIPTS.filter((name) => pkg.scripts?.[name]).map((name) => `npm run ${name}`);
  } catch {
    return [];
  }
}

export function runCheck(command: string, cwd: string, timeoutMs: number): Promise<CheckResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    let output = "";
    let timedOut = false;
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    const finish = (exitCode: number | null, extra = "") => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        output: output + extra,
      });
    };
    child.on("error", (error) => finish(null, `\n${error.message}`));
    child.on("close", (exitCode) => finish(exitCode));
  });
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * The useful part of a failed check's output: lines that look like errors (deduplicated),
 * or the last lines when none do. Keeps the senior from reading hundreds of lines.
 */
export function relevantOutput(output: string, maxLines: number): string {
  const lines = stripAnsi(output)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !/^\s*(>|npm (warn|notice))/i.test(line));
  const errors = [...new Set(lines.filter((line) => ERROR_LINE.test(line)))];
  const picked = errors.length ? errors : lines.slice(-maxLines);
  const shown = picked.slice(0, maxLines);
  const omitted = lines.length - shown.length;
  return omitted > 0 ? `${shown.join("\n")}\n… (${omitted} other lines omitted)` : shown.join("\n");
}

export function formatCheckReport(results: CheckResult[], maxLines: number): string {
  const passed = results.filter((r) => r.exitCode === 0 && !r.timedOut).length;
  const lines = [`## Checks: ${passed}/${results.length} passed`];
  for (const r of results) {
    const seconds = (r.durationMs / 1000).toFixed(1);
    if (r.exitCode === 0 && !r.timedOut) {
      lines.push(`- OK \`${r.command}\` (${seconds}s)`);
      continue;
    }
    const why = r.timedOut ? "TIMED OUT" : `FAILED (exit ${r.exitCode})`;
    lines.push(
      `- ${why} \`${r.command}\` (${seconds}s)`,
      "```",
      relevantOutput(r.output, maxLines) || "(no output)",
      "```",
    );
  }
  return lines.join("\n");
}
