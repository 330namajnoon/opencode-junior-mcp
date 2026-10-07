import { isAbsolute } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectChecks, formatCheckReport, runCheck, type CheckResult } from "../check.js";

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_MAX_LINES = 30;

export function registerCheckTool(server: McpServer): void {
  server.registerTool(
    "junior_check",
    {
      title: "Run the project's checks",
      description:
        "Runs verification commands (tests, lint, typecheck...) in `cwd` one after another and returns only OK/FAILED per command, " +
        "with just the error lines of the failed ones instead of the full output. Use it after a junior task instead of running them with Bash. " +
        "Without `commands` it runs the `typecheck`, `lint` and `test` npm scripts that package.json defines. " +
        "The senior chooses the commands; never pass commands that write to databases, commit, push or deploy.",
      inputSchema: {
        cwd: z
          .string()
          .refine(isAbsolute, "cwd must be an absolute path")
          .describe("Absolute path of the project."),
        commands: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Shell commands to run, e.g. ["npx vitest run test/a.test.ts"]. Default: the npm scripts typecheck, lint and test.',
          ),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(1800)
          .optional()
          .describe(`Time limit per command (default ${DEFAULT_TIMEOUT_SECONDS}).`),
        maxLines: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe(`Max output lines shown per failed command (default ${DEFAULT_MAX_LINES}).`),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ cwd, commands, timeoutSeconds, maxLines }) => {
      const toRun = commands?.length ? commands : await detectChecks(cwd);
      if (!toRun.length) {
        return {
          content: [
            {
              type: "text",
              text: "No commands given and package.json has no typecheck/lint/test scripts. Pass `commands`.",
            },
          ],
          isError: true,
        };
      }
      const results: CheckResult[] = [];
      for (const command of toRun) {
        results.push(
          await runCheck(command, cwd, (timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000),
        );
      }
      return {
        content: [
          { type: "text", text: formatCheckReport(results, maxLines ?? DEFAULT_MAX_LINES) },
        ],
        isError: results.some((r) => r.exitCode !== 0 || r.timedOut),
      };
    },
  );
}
