# opencode-junior-mcp

MCP server for a **senior / junior** way of working: a senior agent (e.g. Claude Code) plans the work and delegates small tasks to a **junior developer** that runs on [opencode](https://opencode.ai) with a cheaper model, reviews what the junior did, and **teaches it with skills** when it makes mistakes.

```
Claude (senior) ──junior_task──▶ opencode run --agent junior ──▶ files in the project
       ▲                                     │
       └──── report from its real tool calls ┘
       └──junior_write_skill──▶ ~/.config/opencode/skills/<name>/SKILL.md ──▶ injected in every new task
```

## Tools

| Tool                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `junior_task`        | Runs one task with `opencode run --format json`. Returns a report built from the junior's **real tool calls**: answer, files changed, grouped failed attempts, tokens, session id and a **compacted diff of only the changes made during the task** (changes already in the tree are left out). Optional `model` (`provider/model`) picks the model; `verbosity` is `brief` (default: answer and diff cut, 40 lines per file) or `full`. |
| `junior_list_skills` | Lists the junior's global skills and, given `cwd`, the project's skills.                                                                                                                                                                                                                                                                                                                                                                 |
| `junior_read_skill`  | Shows one skill.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `junior_write_skill` | Creates or updates a skill (`global` or `project` scope).                                                                                                                                                                                                                                                                                                                                                                                |
| `junior_check`       | Runs verification commands (default: the `typecheck`, `lint` and `test` npm scripts) and returns OK/FAILED per command with only the error lines of failures. Run by the senior; the junior still cannot run commands.                                                                                                                                                                                                                   |

### Why the report does not trust the junior

Small models often claim they did things they did not do (for example, "loaded skill X" without ever calling the skill tool). The report is built from the opencode event stream, not from the junior's summary, and the senior should still review the real `git diff`.

### Why skills are injected into the prompt

The junior's skills are normal opencode skills (`SKILL.md` with `name` / `description` frontmatter), but small models do not reliably load them on their own. So `junior_task` puts every applicable skill at the top of the prompt of each **new** session (a continued session already has them). Project skills (`<project>/.opencode/skills/`) hide global skills with the same name.

## Requirements

- Node.js 20+
- [opencode](https://opencode.ai) with a configured provider/model.
- A `junior` agent in opencode. Copy [`opencode/agent/junior.md`](opencode/agent/junior.md) to `~/.config/opencode/agent/junior.md`: it allows `read`, `glob`, `grep`, `list`, `edit`, `skill` and `webfetch`, and denies bash except `ls`, `cat`, `grep` and `git status/diff/log`. Anything left as `ask` is auto-rejected in headless mode.

## Install as a Claude Code plugin

The plugin bundles the MCP server and the `opencode-junior` skill that starts the senior/junior mode.

```bash
/plugin marketplace add 330namajnoon/opencode-junior-mcp
/plugin install opencode-junior@opencode-junior
```

Then start the mode with `/opencode-junior:opencode-junior` or by asking Claude to "work with the junior".

## Install only the MCP server

```bash
npm install   # also builds dist/
claude mcp add --scope user opencode-junior -- node /absolute/path/to/opencode-junior-mcp/dist/index.js
```

## Saving the senior's tokens

The senior pays for everything it reads, so the tools return as little as possible: `brief` reports, a diff limited to what the task changed, failed attempts collapsed into `×N`, and `junior_check` instead of full test/lint output. Use `verbosity: "full"` or read the files only where the brief report is cut or unclear.

## Configuration

Environment variables (all optional):

| Variable                 | Default                     | Description                                                                 |
| ------------------------ | --------------------------- | --------------------------------------------------------------------------- |
| `OPENCODE_BIN`           | `opencode`                  | opencode executable.                                                        |
| `JUNIOR_MODEL`           | —                           | Default model as `provider/model`. Unset: opencode's default for the agent. |
| `JUNIOR_MODEL_CODE`      | —                           | Model the senior should use for writing/editing code.                       |
| `JUNIOR_MODEL_PLAN`      | —                           | Model for planning, analysing and reviewing.                                |
| `JUNIOR_MODEL_READ`      | —                           | Model for searching, reading, summarising and writing prose.                |
| `JUNIOR_AGENT`           | `junior`                    | opencode agent with the junior's role and permissions.                      |
| `JUNIOR_TIMEOUT_SECONDS` | `180`                       | Default time limit per task.                                                |
| `OPENCODE_ATTACH_URL`    | —                           | URL of a running `opencode serve` to attach to (faster startup).            |
| `JUNIOR_SKILLS_DIR`      | `~/.config/opencode/skills` | Directory of global skills.                                                 |

The per-kind models are shown to the senior in the `junior_task` tool description, so it picks the right one for each task.

With the plugin, set them in the `env` block of `~/.claude/settings.json` (the server inherits Claude Code's environment):

```json
{
  "env": {
    "JUNIOR_MODEL": "provider/general-model",
    "JUNIOR_MODEL_CODE": "provider/coding-model",
    "JUNIOR_MODEL_PLAN": "provider/reasoning-model",
    "JUNIOR_MODEL_READ": "provider/cheap-model"
  }
}
```

With `claude mcp add`, pass them with `-e`, e.g. `claude mcp add --scope user -e JUNIOR_TIMEOUT_SECONDS=300 opencode-junior -- node ...`.

## Development

```bash
npm run dev           # run from source with tsx
npm run build         # compile to dist/
npm run bundle        # single-file bundle used by the plugin (bundle/index.js)
npm test              # vitest
npm run typecheck
npm run lint
npm run format
npm run inspect       # open the MCP Inspector against dist/
```

```
src/
  index.ts            stdio entry point
  server.ts           creates the McpServer and registers the tools
  config.ts           environment configuration
  git.ts              read-only git snapshot for the report
  opencode/
    runner.ts         spawns `opencode run` (stdin closed, timeout, abort)
    events.ts         parses the JSON event stream into a report
    prompt.ts         builds the prompt with the injected skills
  skills/store.ts     read/write SKILL.md files
  tools/              MCP tool definitions
test/                 unit tests (runner tests use a fake opencode in test/fixtures)
bundle/index.js       bundled server run by the plugin (commit it after `npm run bundle`)
.claude-plugin/       plugin manifest and marketplace
.mcp.json             MCP server declared by the plugin
skills/               skill shipped with the plugin
opencode/agent/       example `junior` agent for opencode
```

### Notes

- opencode must be started with stdin closed: with an open stdin `opencode run` waits for input and hangs. The runner uses `stdio: ["ignore", ...]`.
- The junior can only write inside the `--dir` it runs in; writes elsewhere are rejected by opencode (`external_directory`).
