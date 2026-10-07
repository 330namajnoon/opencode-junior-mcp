import { homedir } from "node:os";
import { join } from "node:path";

export interface RoleModels {
  /** Writing and editing code. */
  code: string | undefined;
  /** Planning, analysing and reviewing. */
  plan: string | undefined;
  /** Searching, reading, summarising and writing prose. */
  read: string | undefined;
}

export interface Config {
  /** Path or name of the opencode executable. */
  opencodeBin: string;
  /** Default model as `provider/model`; undefined lets opencode use the agent's or its own default. */
  model: string | undefined;
  /** Optional models suggested per kind of task, shown to the senior in the tool description. */
  roleModels: RoleModels;
  /** opencode agent that defines the junior's role and permissions. */
  agent: string;
  /** Default time limit for a task, in seconds. */
  defaultTimeoutSeconds: number;
  /** Optional URL of a running `opencode serve` instance to attach to. */
  attachUrl: string | undefined;
  /** Directory holding the junior's global skills. */
  globalSkillsDir: string;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    opencodeBin: env.OPENCODE_BIN ?? "opencode",
    model: env.JUNIOR_MODEL || undefined,
    roleModels: {
      code: env.JUNIOR_MODEL_CODE || undefined,
      plan: env.JUNIOR_MODEL_PLAN || undefined,
      read: env.JUNIOR_MODEL_READ || undefined,
    },
    agent: env.JUNIOR_AGENT ?? "junior",
    defaultTimeoutSeconds: positiveInt(env.JUNIOR_TIMEOUT_SECONDS, 180),
    attachUrl: env.OPENCODE_ATTACH_URL || undefined,
    globalSkillsDir: env.JUNIOR_SKILLS_DIR ?? join(homedir(), ".config", "opencode", "skills"),
  };
}
