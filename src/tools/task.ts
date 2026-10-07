import { isAbsolute } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config, RoleModels } from "../config.js";
import {
  compactDiff,
  gitSnapshot,
  onlyNewChanges,
  type DiffLimits,
  type GitSnapshot,
} from "../git.js";
import { buildPrompt } from "../opencode/prompt.js";
import { runJunior, type RunResult } from "../opencode/runner.js";
import type { SkillStore } from "../skills/store.js";

const MAX_TIMEOUT_SECONDS = 1800;

export type Verbosity = "brief" | "full";

interface ReportLimits {
  answerLines: number;
  answerChars: number;
  errorGroups: number;
  diff: DiffLimits;
}

const LIMITS: Record<Verbosity, ReportLimits> = {
  brief: { answerLines: 15, answerChars: 1500, errorGroups: 5, diff: { perFile: 40, total: 250 } },
  full: {
    answerLines: Infinity,
    answerChars: Infinity,
    errorGroups: Infinity,
    diff: { perFile: 300, total: 2000 },
  },
};

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- (none)";
}

function clip(text: string, maxLines: number, maxChars: number): string {
  const lines = text.split("\n");
  let clipped = lines.slice(0, maxLines).join("\n");
  if (clipped.length > maxChars) clipped = clipped.slice(0, maxChars);
  return clipped.length < text.length
    ? `${clipped}\n… (answer cut, ${text.length - clipped.length} more chars; use verbosity "full" to see it)`
    : clipped;
}

/** Same failure repeated N times becomes one line with "×N". */
export function groupErrors(errors: string[], max: number): string[] {
  const counts = new Map<string, number>();
  for (const error of errors) counts.set(error, (counts.get(error) ?? 0) + 1);
  const lines = [...counts].map(([error, n]) => (n > 1 ? `${error} ×${n}` : error));
  return lines.length > max ? [...lines.slice(0, max), `… (${lines.length - max} more)`] : lines;
}

/** Shows paths inside `cwd` relative to it: absolute paths repeated in every report cost tokens. */
export function relativizePaths(result: RunResult, cwd: string): RunResult {
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  const rel = (text: string) => text.split(prefix).join("");
  return {
    ...result,
    text: rel(result.text),
    filesChanged: result.filesChanged.map(rel),
    errors: result.errors.map(rel),
  };
}

export function taskStatus(result: RunResult): string {
  if (result.timedOut) {
    return `TIMED OUT after ${Math.round(result.durationMs / 1000)}s (the junior was stopped; work may be partial)`;
  }
  if (result.exitCode !== 0) return `FAILED (exit code ${result.exitCode})`;
  if (result.finishReason !== "stop") {
    return `ended without finishing its answer (last step: ${result.finishReason ?? "none"})`;
  }
  return "completed";
}

export function formatTaskReport(
  result: RunResult,
  git: GitSnapshot | undefined,
  skillsGiven: string[] = [],
  verbosity: Verbosity = "brief",
): string {
  const limits = LIMITS[verbosity];
  const brief = verbosity === "brief";
  const answer = result.text.trim();
  const tokens = `${result.tokens.input}/${result.tokens.output}/${result.tokens.reasoning}`;

  const sections = [
    `## Junior task: ${taskStatus(result)}`,
    `- Model: ${result.model} · session: ${result.sessionId ?? "(unknown)"} (pass as \`sessionId\` to continue)`,
    `- ${(result.durationMs / 1000).toFixed(1)}s · tokens in/out/reasoning: ${tokens}`,
  ];
  if (brief) {
    sections.push(
      `- Skills given: ${skillsGiven.length ? skillsGiven.join(", ") : "none"} · loaded itself: ${result.skillsLoaded.join(", ") || "none"}`,
    );
  }
  sections.push(
    "",
    "### Junior's answer",
    answer ? clip(answer, limits.answerLines, limits.answerChars) : "(no text answer)",
  );
  if (!brief) {
    sections.push(
      "",
      "### Skills given in the prompt",
      list(skillsGiven),
      "",
      "### Skills it loaded itself with the skill tool",
      list(result.skillsLoaded),
    );
  }
  sections.push(
    "",
    "### Files written or edited (according to its tool calls)",
    list(result.filesChanged),
  );

  if (result.errors.length) {
    sections.push(
      "",
      "### Failed attempts (it may have recovered; repeated ones are worth a skill)",
      list(groupErrors(result.errors, limits.errorGroups)),
    );
  }
  if (result.stderr && (result.exitCode !== 0 || result.timedOut)) {
    sections.push("", "### stderr", "```", result.stderr, "```");
  }

  if (!git) {
    sections.push(
      "",
      "### Changes",
      "(not a git repository — review the files listed above directly)",
    );
  } else {
    const diff = compactDiff(git.diff, limits.diff);
    sections.push(
      "",
      "### Changes made during this task (git, compacted)",
      diff ? ["```diff", diff, "```"].join("\n") : "(no changes)",
    );
    if (!brief) sections.push("", "### git status", "```", git.status || "(clean)", "```");
  }

  return sections.filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");
}

const ROLE_LABELS: Record<keyof RoleModels, string> = {
  code: "writing/editing code",
  plan: "planning, analysing, reviewing",
  read: "searching, reading, summarising, writing prose",
};

/** Tells the senior which model the user wants for each kind of task, if configured. */
export function roleModelsHint(roleModels: RoleModels): string {
  const lines = (Object.keys(ROLE_LABELS) as (keyof RoleModels)[])
    .filter((role) => roleModels[role])
    .map((role) => `${roleModels[role]} for ${ROLE_LABELS[role]}`);
  return lines.length ? ` Configured models per kind of task: ${lines.join("; ")}.` : "";
}

export function registerTaskTool(server: McpServer, config: Config, skills: SkillStore): void {
  const defaultModel = config.model ?? "opencode's default for the agent";
  server.registerTool(
    "junior_task",
    {
      title: "Delegate a task to the junior",
      description:
        `Sends one task to the junior developer (opencode agent "${config.agent}", default model ${defaultModel}) and waits for it to finish. ` +
        "The junior can search, read, write and edit files inside `cwd`, but cannot run commands (only ls, cat, grep and read-only git), commit or touch databases. " +
        "It has NO memory of this conversation: give it full context, exact paths and what not to touch, one small verifiable task per call. " +
        "All its skills (global and project) are included in the prompt of every new session. " +
        "Pass `sessionId` from a previous report to continue the same conversation. " +
        "The report is built from its real tool calls (do not trust its own summary): answer, files changed, grouped failed attempts and a compacted diff of only the changes made during this task. " +
        "Paths inside `cwd` are shown relative to it. Review that diff; read files only where it is cut or unclear.",
      inputSchema: {
        instructions: z
          .string()
          .min(1)
          .describe(
            "The task for the junior: goal, exact file paths, constraints and expected answer format.",
          ),
        cwd: z
          .string()
          .refine(isAbsolute, "cwd must be an absolute path")
          .describe("Absolute path of the project. The junior can only write inside it."),
        sessionId: z
          .string()
          .optional()
          .describe(
            "Session id from a previous junior_task report, to continue that conversation.",
          ),
        model: z
          .string()
          .regex(/^[^/\s]+\/\S+$/, "model must be `provider/model`")
          .optional()
          .describe(
            `Model for this task as \`provider/model\`, as listed by \`opencode models\`. Default ${defaultModel}.` +
              roleModelsHint(config.roleModels) +
              " When continuing a session you can switch model.",
          ),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(MAX_TIMEOUT_SECONDS)
          .optional()
          .describe(`Time limit in seconds (default ${config.defaultTimeoutSeconds}).`),
        verbosity: z
          .enum(["brief", "full"])
          .optional()
          .describe(
            'Report size. "brief" (default) cuts the answer and the diff (40 lines per file); "full" shows everything plus git status.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ instructions, cwd, sessionId, model, timeoutSeconds, verbosity }, extra) => {
      // A continued session already got the skills in its first message.
      const given = sessionId ? [] : await skills.readAll(cwd);
      // Changes already in the tree before the task are not the junior's: leave them out.
      const before = await gitSnapshot(cwd);
      const result = await runJunior(config, {
        prompt: buildPrompt(instructions, given),
        cwd,
        sessionId,
        model,
        timeoutSeconds,
        signal: extra.signal,
      });
      const after = await gitSnapshot(cwd);
      const git =
        after && before ? { ...after, diff: onlyNewChanges(before.diff, after.diff) } : after;
      const failed = result.timedOut || (result.exitCode !== 0 && !result.text);
      return {
        content: [
          {
            type: "text",
            text: formatTaskReport(
              relativizePaths(result, cwd),
              git,
              given.map((skill) => `${skill.name} (${skill.scope})`),
              verbosity,
            ),
          },
        ],
        isError: failed,
      };
    },
  );
}
