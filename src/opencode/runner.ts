import { spawn } from "node:child_process";
import type { Config } from "../config.js";
import { applyEvent, emptyReport, type RunReport } from "./events.js";

export interface RunOptions {
  /** Instructions for the junior. */
  prompt: string;
  /** Absolute path of the project the junior works in. */
  cwd: string;
  /** Continue an existing junior session instead of starting a new one. */
  sessionId?: string;
  /** Model as `provider/model` for this task; defaults to `config.model`, then to opencode's own default. */
  model?: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

export interface RunResult extends RunReport {
  /** Model the task ran on, or a note when opencode picked its default. */
  model: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stderr: string;
}

const MAX_STDERR = 4000;

export function buildArgs(config: Config, options: RunOptions): string[] {
  const model = options.model ?? config.model;
  const args = ["run", "--format", "json", "--agent", config.agent];
  if (model) args.push("--model", model);
  args.push("--dir", options.cwd);
  if (options.sessionId) args.push("--session", options.sessionId);
  if (config.attachUrl) args.push("--attach", config.attachUrl);
  // `--` keeps prompts that start with a dash from being read as flags.
  args.push("--", options.prompt);
  return args;
}

/**
 * Runs one junior task through `opencode run` and returns the parsed report.
 * stdin is closed on purpose: with an open stdin opencode waits for input and hangs.
 */
export function runJunior(config: Config, options: RunOptions): Promise<RunResult> {
  const timeoutMs = (options.timeoutSeconds ?? config.defaultTimeoutSeconds) * 1000;
  const startedAt = Date.now();
  const report = emptyReport();

  return new Promise((resolve, reject) => {
    const child = spawn(config.opencodeBin, buildArgs(config, options), {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let buffer = "";
    let stderr = "";
    let timedOut = false;

    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        applyEvent(report, JSON.parse(trimmed));
      } catch {
        report.errors.push(trimmed);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR) stderr += chunk;
    });

    const kill = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    const onAbort = () => kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(new Error(`Could not start opencode (${config.opencodeBin}): ${error.message}`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      consumeLine(buffer);
      resolve({
        ...report,
        model: options.model ?? config.model ?? "(opencode default)",
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        stderr: stderr.slice(0, MAX_STDERR).trim(),
      });
    });
  });
}
