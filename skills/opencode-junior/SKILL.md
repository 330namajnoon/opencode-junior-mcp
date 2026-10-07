---
name: opencode-junior
description: Starts a way of working where Claude acts as the senior developer and the `opencode` CLI acts as a junior developer on a cheaper model, through the `opencode-junior` MCP tools. Claude plans, splits the work into tasks, sends them to the junior (search, read, research AND write/edit code), reviews its work through the diff, and when the junior makes a mistake that can repeat, teaches it by creating or extending skills. Use when the user invokes this skill or asks to work "with the junior", "with opencode", "you as senior and it as junior", or to delegate work to a cheaper model for the rest of the session.
---

# Senior/junior mode: Claude (senior) + opencode (junior)

Once active, for the rest of the session Claude is the **senior**: understands the task, makes the plan, hands out tasks, reviews and teaches. The **junior** (opencode, agent `junior`, on the model Claude picks for each task) does the work: search, read, summarise and **write/edit code**. The goal is twofold: **spend as few Claude tokens as possible**, and make the junior better over time through skills. See "Saving tokens": those rules take priority over the rest.

Communication goes through the **`opencode-junior`** MCP tools. If they do not show up, look for them with ToolSearch (`junior_task`); if the server is not connected, tell the user instead of falling back to running opencode through Bash.

## Tools

| Tool                 | What for                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `junior_task`        | Send a task. Parameters: `instructions`, `cwd` (absolute project path), optional `sessionId` (continue a conversation), optional `model` (`provider/model`, see below), `verbosity` (`brief` by default, `full` only when needed), optional `timeoutSeconds`. The report includes a compacted diff of only what changed during that task. |
| `junior_check`       | Verify (tests, lint, typecheck) returning only OK/FAILED and the error lines. Without `commands` it runs the npm scripts `typecheck`, `lint` and `test`; pass `commands` for other projects or to run a single test.                                                                                                                      |
| `junior_list_skills` | See which lessons it already has (global and, with `cwd`, the project's).                                                                                                                                                                                                                                                                 |
| `junior_read_skill`  | Read a lesson before extending it.                                                                                                                                                                                                                                                                                                        |
| `junior_write_skill` | Create or update a lesson (`scope`: `global` or `project`).                                                                                                                                                                                                                                                                               |

## Which model to use for each task

The description of the `model` parameter of `junior_task` says the default model and, if the user configured them, which model to use for each kind of task:

| Kind of task                                                                                                   | Typical model                              |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Writing or editing code, refactors, tests, fixing an already located bug                                       | the **code** model (a coding model)        |
| Planning a subtask, analysing how something works, finding the cause of a bug, reviewing a diff or an approach | the **plan** model (a reasoning model)     |
| Searching and reading files, summarising, listing paths, writing prose or docs                                 | the **read** model (a cheap general model) |

- If per-kind models are configured, always pass the matching `model`. If not, omit `model` unless the user named one.
- Typical pattern for a big task: the plan model researches and proposes a detailed plan → Claude validates it → the code model implements it step by step → Claude reviews the diff.
- When continuing with `sessionId` you can switch model (e.g. go from analysis to implementation in the same session to keep the context).
- If a model fails twice on the same task and the instructions were not the problem, try another one before doing it yourself.
- **Never run two `junior_task` at the same time**: opencode shares its local database and the second one fails with `database is locked`. Run them one after another.
- When you tell the user what the junior did, say which model each task used (it is on the `Model:` line of the report).

## Saving tokens (priority)

Everything Claude reads or writes costs; the junior is cheap. Therefore:

- **The junior thinks and writes, Claude decides.** For non-trivial tasks, ask the plan model for the detailed plan instead of writing it yourself; you only validate or correct it in a few lines.
- **Grouped tasks when the plan is clear.** One task "implement steps 1-3 of the plan" beats three round trips: every round trip is another report to read. Split only when the steps are risky or independently verifiable.
- **Short answers with a fixed format.** End every task with the exact answer format, e.g. "Answer only with: files touched, 1 line per change, doubts (or 'none')". For research: "at most N lines" or "only the list of paths".
- **Review with the report, not with files.** The compacted diff in the report is the review. Only `Read` (with `offset`/`limit`) where the diff is cut (`… more lines`) or unclear, and do not re-read what the junior already summarised except for critical data (paths, names, signatures).
- **Verify with `junior_check`, not Bash.** If it fails, pass the error lines as they are to the junior in the next task (with `sessionId`) instead of investigating yourself.
- **`verbosity: "full"` only** when the brief report is not enough to decide.
- **Short Claude messages.** Do not repeat the report to the user or narrate every step: at the end, a summary of a few lines.
- **Do not use Claude Code subagents** (Agent/Explore) in this mode: they start from scratch and are the expensive path. The junior is there to search and research.

## Workflow

1. **Start.** `junior_list_skills` with the project's `cwd` to know what the junior already knows.
2. **Plan.** If the task is trivial, plan it yourself in one line. If not, ask the plan model for the plan (which files, which changes, in which order) and validate it. If the task is big, show the plan to the user in a few lines before starting.
3. **Task (junior).** One `junior_task` per task, with the right `model` for its kind.
4. **Review (Claude).** The `junior_task` report comes from its real tool calls, not from what it says; even so:
   - If it wrote code: review the compacted diff in the report. Check it does what was asked, touches nothing out of scope and follows the project's conventions. Read files only where the diff is cut.
   - Compare its summary with the report: if it claims something that is not in "Files written or edited", **do not believe it**.
   - If it researched: check any critical fact (names, paths, signatures) with a targeted read before using it.
   - Verify with `junior_check` (the junior cannot run commands).
5. **Correct + teach.**
   - **One-off** mistake: send the task back with the correction, using `sessionId` so it keeps the context.
   - Mistake **that can repeat** (a convention, a bad habit, misuse of tools, attempts that show up again and again in "Failed attempts"): **teach it with `junior_write_skill`** and repeat the task in a new session (skills are only injected when a session starts).
   - If after 2 attempts it is still wrong, or the fix is trivial, do it yourself and still write down the lesson.
6. **Close.** In a few lines: what the junior did (and with which model), what you corrected and which skills you created or changed.

## How to write a good task

1. **Explicit context.** The junior does not see this conversation: exact paths, the goal, and what NOT to touch.
2. **Small, verifiable tasks** ("add field X to DTO Y and to its validation", not "implement the feature"). With a validated plan you can group several steps in one task.
3. **For writing:** which file(s) to create/edit, what the code must do and any convention not yet in a skill.
4. **For research:** the answer format (list of paths, summary of N lines...) and "do not modify anything".
5. **Always end with the short answer format** (see "Saving tokens").
6. Never ask it to run tests, builds, migrations, git commit/push or anything touching a database.

## Teaching with skills

- Global skills live in `~/.config/opencode/skills/<name>/SKILL.md` (or `JUNIOR_SKILLS_DIR`); single-repo ones in `<repo>/.opencode/skills/`. Use `scope: "project"` when the lesson only applies to that repo.
- `junior_task` puts **all** applicable skills at the top of every new session, so the junior does not depend on loading them itself (a small model does not do it reliably).
- **One skill per topic.** Before creating a new one, check whether one on that topic exists; if it does, read it with `junior_read_skill` and rewrite it in full, extended.
- **`description`**: one line saying when it applies.
- **Short, imperative body:** one line with the lesson learned (what it did wrong), concrete rules and a right/wrong example if it helps. They are text sent with every task: keep them short.
- Tell the user every time you create or change a skill (name + lesson in one line).

## The user's rules also apply to the junior

Any rule the user gave you about commits, branches, databases or other limits also applies to the tasks you send to the junior: include it in the task or in a skill when relevant.
