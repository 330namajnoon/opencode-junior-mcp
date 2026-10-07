import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { SkillStore } from "./skills/store.js";
import { registerCheckTool } from "./tools/check.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerTaskTool } from "./tools/task.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function createServer(config: Config): McpServer {
  const server = new McpServer(
    { name: "opencode-junior", version },
    {
      instructions:
        "Tools to work as a senior developer with a junior developer that runs on opencode. " +
        "Plan the work, delegate small tasks with junior_task, review the compacted diff in its report, " +
        "verify with junior_check (not Bash) to keep outputs short, " +
        "and when the junior repeats a kind of mistake, teach it with junior_write_skill.",
    },
  );
  const skills = new SkillStore(config.globalSkillsDir);
  registerTaskTool(server, config, skills);
  registerSkillTools(server, skills);
  registerCheckTool(server);
  return server;
}
